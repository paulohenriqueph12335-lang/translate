import type { Draft, DraftBlock } from './draft.js';

/**
 * Diagramação construída para documentos que o sistema ainda não conhece (ADR-020).
 *
 * Em vez de depender de um documento igual, o sistema reconhece o papel de cada parte (cabeçalho do órgão, título,
 * campos "rótulo: valor", tabelas, texto corrido, local e data, assinatura, marcadores, rodapé), aprende com as
 * traduções concluídas como cada papel é diagramado e, para um documento novo, combina o que aprendeu dos documentos
 * de estrutura mais parecida. A formatação conhecida do original sempre prevalece: o aprendido só completa o que falta.
 */

export const ROLES = [
  'marker',
  'authority',
  'title',
  'heading',
  'field',
  'field_table',
  'data_table',
  'prose',
  'line',
  'place_date',
  'signature_line',
  'signatory',
  'note',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  marker: 'elemento visual',
  authority: 'cabeçalho do órgão',
  title: 'título',
  heading: 'seção',
  field: 'campo "rótulo: valor"',
  field_table: 'tabela de campos',
  data_table: 'tabela de dados',
  prose: 'texto corrido',
  line: 'linha curta',
  place_date: 'local e data',
  signature_line: 'linha de assinatura',
  signatory: 'quem assina',
  note: 'nota de rodapé',
};

type Align = 'left' | 'center' | 'right' | 'justify';
interface RoleStyle {
  align: Align;
  bold: boolean;
  size: 'normal' | 'small' | 'tiny';
  /** O papel saiu como título (heading) nos documentos conhecidos. */
  heading: boolean;
}

const plain = (text: string) => text.replace(/\*\*/g, '').trim();
const isCaps = (text: string) => /\p{Lu}{3}/u.test(text) && !/\p{Ll}/u.test(plain(text));
const FIELD = /^([\p{L}][\p{L}\s()./º°ª-]{1,40}?)\s*:\s+\S/u;
const isField = (text: string) => {
  const match = FIELD.exec(plain(text));
  return !!match && match[1]!.trim().split(/\s+/).length <= 5;
};
const PLACE_DATE = /^[\p{Lu}][\p{L}'’ .-]{2,40},\s.*\b(1[89]|20)\d{2}\.?$/u;

/** Texto visível de um bloco (para os papéis). */
function textOf(block: DraftBlock) {
  if (block.kind === 'table') return block.rows.map((row) => row.cells.map((cell) => cell.text).join(' ')).join(' ');
  if (block.kind === 'signature') return `${block.name} ${block.role}`;
  return block.text;
}

/** Papel de cada bloco no documento, pela posição, pela forma do texto e pela vizinhança. */
export function rolesOf(draft: Draft): Role[] {
  const blocks = draft.blocks;
  const roles: Role[] = [];
  const titleIndex = blocks.findIndex(
    (block) =>
      (block.kind === 'heading' && block.level === 'title') ||
      (!!draft.sourceTitle.trim() && 'sourceText' in block && block.sourceText?.replace(/\*\*/g, '').trim() === draft.sourceTitle.trim()),
  );
  // Sem título marcado: a última linha da sequência de maiúsculas do topo ("PREFEITURA / SECRETARIA / DECLARAÇÃO").
  let title = titleIndex;
  if (title < 0) {
    let last = -1;
    for (let index = 0; index < Math.min(blocks.length, 8); index += 1) {
      const block = blocks[index]!;
      const text = block.kind === 'paragraph' || block.kind === 'heading' ? plain(block.text) : '';
      if (/^\[[^\]]+\]$/.test(text)) continue;
      if (text && isCaps(text) && text.length < 90 && !isField(text)) last = index;
      else if (last >= 0) break;
    }
    title = last;
  }
  blocks.forEach((block, index) => {
    const text = plain(textOf(block));
    const previous = roles[index - 1];
    if (block.kind === 'table') {
      const twoColumns = block.columns.length === 2;
      const shortLabels = block.rows.filter((row) => row.cells[0] && plain(row.cells[0].text).split(/\s+/).length <= 5).length;
      roles.push(twoColumns && shortLabels >= block.rows.length * 0.7 ? 'field_table' : 'data_table');
      return;
    }
    if (block.kind === 'signature') {
      roles.push('signatory');
      return;
    }
    if (/^\[[^\]]+\]$/.test(text)) roles.push('marker');
    else if (/^_{5,}$/.test(text)) roles.push('signature_line');
    else if (previous === 'signature_line' || (previous === 'signatory' && text.length < 80 && !text.endsWith('.'))) roles.push('signatory');
    else if (index === title) roles.push('title');
    else if (PLACE_DATE.test(text)) roles.push('place_date');
    else if (block.kind === 'heading' || block.kind === 'section') roles.push(title >= 0 && index < title ? 'authority' : 'heading');
    // Campo pelo original também: a tradução pode alongar o rótulo ("CPF" → "CPF (Brazilian Individual …)").
    else if (isField(text) || (text.includes(':') && 'sourceText' in block && !!block.sourceText && isField(block.sourceText))) roles.push('field');
    else if (isCaps(text) && text.length < 90 && (title < 0 || index < title)) roles.push('authority');
    else if (block.kind === 'paragraph' && block.size !== 'normal' && index > blocks.length * 0.6) roles.push('note');
    // Texto corrido é frase longa; linha curta (nome de órgão, cargo, legenda) tem diagramação própria.
    else if (text.length >= 70 || text.split(/\s+/).length >= 10) roles.push('prose');
    else roles.push('line');
  });
  return roles;
}

/** O que se aprendeu de um documento concluído: a mistura de papéis e como cada papel foi diagramado. */
export interface LayoutSample {
  /** Título do original (ou tipo), para dizer de onde veio o padrão. */
  title: string;
  /** Proporção de cada papel no documento (vetor de estrutura). */
  shape: number[];
  styles: Partial<Record<Role, RoleStyle>>;
  /** Campos foram para tabela de duas colunas, e a largura da coluna de rótulos (%). */
  fieldsAsTable: boolean | null;
  labelWidth: number | null;
}

/** Estilo mais comum de cada papel no documento. */
function stylesOf(draft: Draft, roles: Role[]) {
  const tally = new Map<Role, Map<string, number>>();
  draft.blocks.forEach((block, index) => {
    if (block.kind !== 'paragraph' && block.kind !== 'heading' && block.kind !== 'section') return;
    const style: RoleStyle = {
      align: block.kind === 'section' ? 'left' : block.align,
      bold: block.kind === 'paragraph' ? block.bold : true,
      size: block.kind === 'paragraph' ? block.size : 'normal',
      heading: block.kind !== 'paragraph',
    };
    const role = roles[index]!;
    const key = JSON.stringify(style);
    const counts = tally.get(role) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    tally.set(role, counts);
  });
  const styles: Partial<Record<Role, RoleStyle>> = {};
  for (const [role, counts] of tally) styles[role] = JSON.parse([...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]) as RoleStyle;
  return styles;
}

function shapeOf(roles: Role[]) {
  const total = Math.max(1, roles.length);
  return ROLES.map((role) => roles.filter((item) => item === role).length / total);
}

/** Aprende com uma tradução concluída. */
export function learnLayout(draft: Draft): LayoutSample {
  const roles = rolesOf(draft);
  const fieldTables = draft.blocks.filter((_, index) => roles[index] === 'field_table') as Array<Extract<DraftBlock, { kind: 'table' }>>;
  const loose = roles.filter((role) => role === 'field').length;
  const tableRows = fieldTables.reduce((sum, table) => sum + table.rows.length, 0);
  const widths = fieldTables.map((table) => (table.columns[0]! / (table.columns[0]! + table.columns[1]!)) * 100);
  return {
    title: (draft.sourceTitle || draft.documentType || 'documento').slice(0, 80),
    shape: shapeOf(roles),
    styles: stylesOf(draft, roles),
    fieldsAsTable: tableRows || loose ? tableRows >= loose : null,
    labelWidth: widths.length ? Math.round(widths.reduce((sum, value) => sum + value, 0) / widths.length) : null,
  };
}

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(a) * norm(b) || 1);
};

export interface ComposeResult {
  draft: Draft;
  /** Documentos conhecidos usados, com a semelhança de estrutura (0–100). */
  borrowedFrom: Array<{ title: string; similarity: number }>;
  changes: Array<{ block: number; message: string; before: string; after: string }>;
  roles: Role[];
}

/** O original veio sem formatação (OCR, texto sem layout): tudo à esquerda e nada em negrito. */
export function layoutIsUnknown(draft: Draft) {
  const shaped = draft.blocks.filter((block) => block.kind === 'paragraph' || block.kind === 'heading');
  if (!shaped.length) return false;
  // Justificado o leitor de PDF deduz da largura da linha; centralização, direita e negrito vêm do original.
  return shaped.every((block) => block.kind === 'paragraph' && (block.align === 'left' || block.align === 'justify') && !block.bold);
}

/**
 * Constrói a diagramação de um documento novo combinando os documentos conhecidos de estrutura mais parecida.
 * Com formatação do original conhecida, só completa o que falta (campos soltos, tipo); sem ela, aplica o estilo
 * aprendido de cada papel. Nenhum texto muda.
 */
/**
 * Sem formatação (OCR), cada linha da imagem vira um parágrafo: junta a linha que continua na seguinte (sem ponto
 * final e a seguinte começando em minúscula), no texto traduzido e no original.
 */
function joinWrappedLines(draft: Draft) {
  let joined = 0;
  const blocks: DraftBlock[] = [];
  // Linha com espaço largo no meio ("Cidade: Serra Clara    SC") a leitura toma por tabela de uma linha: volta a ser linha.
  const lines = draft.blocks.map((block): DraftBlock =>
    block.kind === 'table' && block.rows.length === 1 && block.rows[0]!.cells.length <= 3
      ? {
          kind: 'paragraph',
          text: block.rows[0]!.cells.map((cell) => cell.text).join(' '),
          align: 'left',
          bold: false,
          size: 'normal',
          sourceText: block.rows[0]!.cells.map((cell) => cell.sourceText ?? cell.text).join(' '),
          origin: block.origin,
        }
      : block,
  );
  for (const block of lines) {
    const previous = blocks.at(-1);
    if (
      block.kind === 'paragraph' &&
      previous?.kind === 'paragraph' &&
      !/[.:;!?]$/.test(plain(previous.text)) &&
      /^\p{Ll}/u.test(plain(block.text)) &&
      !isField(previous.text)
    ) {
      previous.text = `${previous.text} ${block.text}`;
      previous.sourceText = previous.sourceText && block.sourceText ? `${previous.sourceText} ${block.sourceText}` : previous.sourceText;
      joined += 1;
    } else blocks.push(block);
  }
  draft.blocks = blocks;
  return joined;
}

export function composeLayout(input: Draft, knowledge: LayoutSample[], options: { neighbors?: number } = {}): ComposeResult {
  const draft: Draft = structuredClone(input);
  const unknownLayout = layoutIsUnknown(draft);
  const joined = unknownLayout && knowledge.length ? joinWrappedLines(draft) : 0;
  const roles = rolesOf(draft);
  const shape = shapeOf(roles);
  const ranked = knowledge
    .map((sample) => ({ sample, similarity: cosine(shape, sample.shape) }))
    .filter((item) => item.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.neighbors ?? 5);
  const changes: ComposeResult['changes'] = [];
  // O mesmo tipo aparece várias vezes entre os vizinhos: a origem mostra cada um uma vez, com a maior semelhança.
  const borrowed = new Map<string, number>();
  for (const item of ranked) borrowed.set(item.sample.title, Math.max(borrowed.get(item.sample.title) ?? 0, Math.round(item.similarity * 100)));
  const borrowedFrom = [...borrowed.entries()].map(([title, similarity]) => ({ title, similarity }));
  if (joined) changes.push({ block: 0, message: `${joined} linha(s) quebrada(s) pela leitura juntada(s) ao parágrafo`, before: '', after: '' });
  if (!ranked.length) return { draft, borrowedFrom, changes, roles };

  const weight = ranked.reduce((sum, item) => sum + item.similarity, 0);
  /** Estilo do papel pela votação ponderada dos vizinhos; só vale com maioria de 60%. */
  const styleFor = (role: Role): RoleStyle | null => {
    const votes = new Map<string, number>();
    for (const { sample, similarity } of ranked) {
      const style = sample.styles[role];
      if (style) votes.set(JSON.stringify(style), (votes.get(JSON.stringify(style)) ?? 0) + similarity);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const style = best && best[1] / weight >= 0.6 ? (JSON.parse(best[0]) as RoleStyle) : null;
    // Texto corrido é sempre à esquerda ou justificado, em qualquer documento.
    if (role === 'prose') return { align: style?.align === 'left' ? 'left' : 'justify', bold: false, size: 'normal', heading: false };
    return style;
  };

  // 1. Sem formatação no original: cada papel ganha o estilo aprendido.
  if (unknownLayout) {
    let styled = 0;
    draft.blocks = draft.blocks.map((block, index): DraftBlock => {
      if (block.kind !== 'paragraph') return block;
      const role = roles[index]!;
      const style = styleFor(role);
      if (!style) return block;
      const next: DraftBlock =
        style.heading || role === 'title'
          ? { kind: 'heading', text: block.text, align: style.align, level: role === 'title' ? 'title' : 'normal', sourceText: block.sourceText, origin: block.origin }
          : { ...block, align: style.align, bold: style.bold, size: style.size };
      if (JSON.stringify(next) !== JSON.stringify(block)) styled += 1;
      return next;
    });
    if (styled) {
      changes.push({
        block: 0,
        message: `Alinhamento, destaque e títulos de ${styled} bloco(s) pelo padrão de documentos parecidos`,
        before: 'original sem formatação',
        after: borrowedFrom.map((item) => item.title).join(', '),
      });
    }
  }

  // 2. Campos soltos viram tabela quando os documentos parecidos usam tabela de campos.
  const tableVotes = ranked.filter((item) => item.sample.fieldsAsTable !== null);
  const tableWeight = tableVotes.reduce((sum, item) => sum + item.similarity, 0);
  const asTable =
    tableVotes.length > 0 && tableVotes.filter((item) => item.sample.fieldsAsTable).reduce((sum, item) => sum + item.similarity, 0) / tableWeight >= 0.5;
  if (asTable) {
    const widths = ranked.map((item) => item.sample.labelWidth).filter((value): value is number => value !== null);
    const label = widths.length ? Math.round(widths.reduce((sum, value) => sum + value, 0) / widths.length) : 35;
    const blocks: DraftBlock[] = [];
    let run: Array<Extract<DraftBlock, { kind: 'paragraph' }>> = [];
    const split = (text: string) => {
      const at = text.indexOf(':');
      return { label: plain(text.slice(0, at)), value: text.slice(at + 1).trim() };
    };
    const flush = () => {
      if (run.length >= 2) {
        blocks.push({
          kind: 'table',
          columns: [label, 100 - label],
          rows: run.map((block) => {
            const target = split(block.text);
            const source = block.sourceText && block.sourceText.includes(':') ? split(block.sourceText) : null;
            return {
              style: 'normal' as const,
              cells: [
                { text: target.label, sourceText: source?.label ?? null, colSpan: 1, rowSpan: 1, bold: true, align: 'left' as const },
                { text: target.value, sourceText: source?.value ?? null, colSpan: 1, rowSpan: 1, bold: false, align: 'left' as const },
              ],
            };
          }),
          sourceText: run.map((block) => block.sourceText ?? '').join('\n') || null,
          origin: run[0]!.origin,
        });
        changes.push({
          block: blocks.length,
          message: `${run.length} campos alinhados em tabela (${label}% / ${100 - label}%), como nos documentos parecidos`,
          before: run.map((block) => block.text).join(' | ').slice(0, 300),
          after: 'tabela de campos',
        });
      } else blocks.push(...run);
      run = [];
    };
    draft.blocks.forEach((block, index) => {
      if (block.kind === 'paragraph' && roles[index] === 'field') run.push(block);
      else {
        flush();
        blocks.push(block);
      }
    });
    flush();
    draft.blocks = blocks;
  }

  // 3. Tipo do documento: o título reconhecido (ou a primeira linha do cabeçalho em maiúsculas).
  if (!draft.documentType.trim()) {
    const title = input.blocks[roles.indexOf('title')] ?? input.blocks[roles.indexOf('authority')];
    const text = title && title.kind !== 'table' && title.kind !== 'signature' ? plain(title.text).toUpperCase() : '';
    if (text) {
      draft.documentType = text.slice(0, 200);
      changes.push({ block: 0, message: 'Tipo do documento pelo título reconhecido', before: '', after: draft.documentType });
    }
  }
  return { draft, borrowedFrom, changes, roles };
}

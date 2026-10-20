import type { GlossaryTerm } from '../checks.js';
import { isCodeLike, isMeasurement, keptCells } from '../codes.js';
import { convertLongDates, convertNumericDate, numericDateToLong, separatorsDiffer } from '../conventions.js';
import { stripEmphasis } from '../checks.js';
import type { Draft, DraftBlock, Language, TableCell } from '../draft.js';
import type { SourceLayout } from '../layout/source-layout.js';
import { markerText, noteText, noteTranslation, visualLabel } from './notes.js';
import { personNames, placeNames, webAddresses } from './proper-names.js';
import type { MachineTranslator } from './providers.js';

/** Busca na memória de tradução: trecho do original (normalizado) → tradução aprovada. */
export type MemoryLookup = (segments: string[]) => Promise<Map<string, string>>;

export interface MachineDraftInput {
  sourceLanguage: Language;
  targetLanguage: Language;
  /** Estrutura do original (ADR-009); sem ela, a estrutura é inferida do texto extraído. */
  layout?: SourceLayout | null;
  extractedText?: string | null;
  glossary: GlossaryTerm[];
  translator: MachineTranslator | null;
  memory: MemoryLookup;
  /** Tipo e título conhecidos de um exemplo aprovado do mesmo tipo, se houver. */
  known?: { documentType: string; sourceTitle: string } | null;
  /** Regras da modalidade (ADR-015): datas, números e como indicar elementos visuais. Sem regra, o padrão antigo. */
  rules?: (SegmentRules & { visualElements?: 'markers' | 'translator_notes' }) | null;
}

export interface MachineDraftResult {
  draft: Draft;
  stats: { segments: number; fromMemory: number; translated: number; characters: number };
}

/** Normalização usada como chave da memória de tradução. */
export const memoryKey = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

const hasLetters = (text: string) => /\p{L}{2}/u.test(text);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const englishOrdinal = (value: number) => {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th';
};

/** Como a regra da modalidade trata datas e números (ADR-015); sem regra, o comportamento original (ADR-008). */
export interface SegmentRules {
  /** long: por extenso no idioma de destino; as_original: só o nome do mês muda; convert: troca dia e mês (padrão antigo). */
  dates?: 'long' | 'as_original' | 'convert';
  /** keep: números como no original; convert: separador decimal do destino. */
  numbers?: 'keep' | 'convert';
}

/**
 * Antes de traduzir: datas e decimais no formato do destino (ADR-008). Identificadores com mais de um separador
 * (RG, CPF, matrícula) não casam com o padrão de decimal e ficam intactos. Com a regra das skills (ADR-015), os números
 * ficam como no original e as datas saem por extenso ou no formato do original.
 */
export function prepareSegment(text: string, from: Language, to: Language, rules: SegmentRules = {}) {
  const dates = rules.dates ?? 'convert';
  const numbers = rules.numbers ?? 'convert';
  let result = text;
  if (dates === 'long') result = numericDateToLong(result, from, to);
  else if (dates === 'convert') result = convertNumericDate(result, from, to);
  result = convertLongDates(result, from, to);
  if (from === 'pt' && to === 'en') {
    // "nº 0458" → "No. 0458"; "1ª/2º" → "1st/2nd" (o marcador de número isolaria o sufixo e o provedor o traduz mal).
    result = result
      .replace(/\b[nN][º°]\s*/g, 'No. ')
      .replace(/\b(\d+)[ªº°]/g, (_match, value: string) => `${value}${englishOrdinal(Number(value))}`);
  }
  if (from === 'pt' && to === 'fr') {
    // "1ª/1º" → "1re/1er"; demais "2e" (as skills: ordinais no padrão do idioma de destino).
    result = result.replace(/(\d+)([ªº°])/g, (_match, value: string, mark: string) =>
      value === '1' ? (mark === 'ª' ? '1re' : '1er') : `${value}e`,
    );
  }
  if (from === 'en' && to !== 'en') {
    // "Part No." / "Chip NO." é abreviação de número: o provedor lê como a palavra "no" ("Chip não").
    result = result.replace(/\b(No|NO)\.(?=\s|$)/g, to === 'fr' ? 'n°' : 'nº');
  }
  if (numbers === 'convert' && separatorsDiffer(from, to)) {
    result =
      to === 'en'
        ? result.replace(/(?<![\d.,/-])(\d{1,3}),(\d{1,2})(?![\d.,/-])/g, '$1.$2')
        : result.replace(/(?<![\d.,/-])(\d{1,3})\.(\d{1,2})(?![\d.,/-])/g, '$1,$2');
  }
  return result;
}

/**
 * Termos do glossário e trechos com dígitos viram marcadores que o provedor não altera, e voltam como a tradução
 * aprovada ou o número já convertido. Sem isso, provedores trocam separadores de identificadores ("000.123.456-7").
 */
export function protectSegment(text: string, glossary: GlossaryTerm[], keep: string[] = []) {
  const restore: Array<[string, string]> = [];
  const mark = (prefix: string, value: string) => {
    const marker = `[[${prefix}${restore.length}]]`;
    restore.push([marker, value]);
    return marker;
  };
  let protectedText = text;
  // Marcadores do original entre colchetes ("[CARIMBO]", "[QR CODE]"): o provedor costuma apagá-los.
  protectedText = protectedText.replace(/\[[^[\]]{2,60}\]/g, (value) => mark('M', value));
  [...glossary]
    .sort((left, right) => right.source.length - left.source.length)
    .forEach((term) => {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.source)}(?![\\p{L}\\p{N}])`, 'giu');
      protectedText = protectedText.replace(pattern, () => mark('G', term.target));
    });
  // Nomes próprios, cidades e endereços eletrônicos ficam como no original (regra das skills).
  [...new Set(keep)]
    .filter((value) => value.trim().length >= 3)
    .sort((left, right) => right.length - left.length)
    .forEach((value) => {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\[])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, 'gu');
      protectedText = protectedText.replace(pattern, () => mark('P', value));
    });
  // Abreviações com pontos ("S.A.", "U.F."): o provedor junta ou apaga letras ("BANCO FICTICIO.A.").
  protectedText = protectedText.replace(/(?<![\p{L}\[])(?:\p{Lu}\.){2,}/gu, (value) => mark('P', value));
  protectedText = protectedText.replace(/\*\*/g, () => mark('B', '**'));
  // Abreviações de número ("nº") o provedor estraga ("n.o", "não"): vão como marcador.
  protectedText = protectedText.replace(/(?<![\p{L}\p{N}])[nN][º°](?![\p{L}])/gu, (value) => mark('S', value));
  protectedText = protectedText.replace(/(?<!\[\[[GNBSPM]\d*)\p{N}(?:[\p{N}.,/:-]*\p{N})?[ªº°]?/gu, (value) => mark('N', value));
  const values = new Map(restore);
  return {
    text: protectedText,
    /**
     * Devolve o texto com os valores originais, aceitando marcadores com colchetes perdidos ("[[N0]", "[N0]").
     * Retorna `null` se algum marcador sumiu: melhor o trecho sem tradução do que um número perdido em silêncio.
     */
    restore: (translated: string): string | null => {
      const seen = new Set<string>();
      const result = translated.replace(/\[{1,2}\s*([GNBSPM])\s*(\d+)\s*\]{1,2}/gi, (match, prefix: string, index: string) => {
        const marker = `[[${prefix.toUpperCase()}${index}]]`;
        const value = values.get(marker);
        if (value === undefined) return match;
        seen.add(marker);
        return value;
      });
      return seen.size === values.size ? result : null;
    },
  };
}

/** Só o glossário aplicado, sem marcadores (texto de reserva quando a tradução falha). */
function withGlossaryOnly(text: string, glossary: GlossaryTerm[]) {
  const guarded = protectSegment(text, glossary);
  return guarded.restore(guarded.text) ?? text;
}

/**
 * Sem layout (imagens, PPTX): linhas com colunas viram tabelas ("a | b" do DOCX ou espaço largo do PDF),
 * as demais viram parágrafos.
 */
export function layoutFromText(text: string): SourceLayout {
  const blocks: DraftBlock[] = [];
  for (const line of text
    .split('\n')
    .map((value) => value.replace(/\s{2,}/g, '  ').trim())
    .filter(Boolean)) {
    const cells = (line.includes(' | ') ? line.split(' | ') : line.split(/ {2,}/)).map((cell) => cell.trim()).filter(Boolean);
    const last = blocks.at(-1);
    const cell = (value: string): TableCell => ({ text: value, sourceText: value, colSpan: 1, rowSpan: 1, bold: false, align: 'left' });
    if (cells.length >= 2) {
      if (last?.kind === 'table' && last.rows[0]!.cells.length === cells.length)
        last.rows.push({ style: 'normal', cells: cells.map(cell) });
      else
        blocks.push({
          kind: 'table',
          columns: cells.map(() => 1),
          rows: [{ style: 'normal', cells: cells.map(cell) }],
          sourceText: null,
          origin: 'rules',
        });
    } else blocks.push({ kind: 'paragraph', text: line, align: 'left', bold: false, size: 'normal', sourceText: line, origin: 'rules' });
  }
  return { blocks, notes: [], title: null };
}

type Translated = { text: string; origin: 'machine' | 'memory' | 'rules' };

const LOCALE: Record<Language, string> = { pt: 'pt-BR', en: 'en-US', fr: 'fr-FR', it: 'it-IT', es: 'es-ES' };

/** Só maiúsculas (com pelo menos duas letras seguidas). */
export const isAllCaps = (text: string) => /\p{Lu}{2}/u.test(text) && !/\p{Ll}/u.test(text.replace(/\[\[[A-Z]\d+\]\]/g, ''));

/**
 * Trecho pronto para o provedor: glossário, números, nomes próprios e marcadores protegidos. Texto todo em maiúsculas
 * o provedor traduz mal ("REPÚBLICA FICTÍCIA" → "RÉPUBLIQUE FICIQUE"): vai em minúsculas e volta em maiúsculas.
 */
export function guardForTranslation(prepared: string, to: Language, glossary: GlossaryTerm[], keep: string[] = []) {
  const guarded = protectSegment(prepared, glossary, keep);
  // Siglas curtas ("RG", "CPF") vão como estão.
  if (!isAllCaps(prepared) || !/\p{Lu}{4}/u.test(prepared)) return { text: guarded.text, restore: guarded.restore };
  return {
    text: sentenceCase(guarded.text),
    restore: (value: string) => guarded.restore(value)?.toLocaleUpperCase(LOCALE[to]) ?? null,
  };
}

/** Nomes de pessoas, cidades e endereços de um conjunto de trechos, para proteger em todos eles. */
export function properNounsOf(texts: string[]) {
  const places = texts.flatMap(placeNames);
  return [...texts.flatMap(personNames), ...places, ...places.map((place) => place.toLocaleUpperCase('pt-BR')), ...texts.flatMap(webAddresses)];
}

/** Minúsculas com a primeira letra maiúscula, sem mexer nos marcadores de proteção ("[[N0]]"). */
function sentenceCase(text: string) {
  const lower = text.replace(/\[\[[A-Z]\d+\]\]|[^[]+|\[/g, (part) => (part.startsWith('[[') ? part : part.toLocaleLowerCase('pt-BR')));
  return lower.replace(/\p{Ll}/u, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

/**
 * Rascunho com a estrutura do original (ADR-009) e o texto traduzido trecho a trecho (ADR-008): memória de tradução
 * primeiro, depois o provedor gratuito; sem provedor, o texto original preparado (datas, decimais e glossário).
 * Tabelas, mesclagens, alinhamento, tamanhos e negrito vêm do layout e não passam pelo provedor.
 */
export async function buildMachineDraft(input: MachineDraftInput): Promise<MachineDraftResult> {
  const { sourceLanguage: from, targetLanguage: to } = input;
  const segmentRules: SegmentRules = {
    ...(input.rules?.dates ? { dates: input.rules.dates } : {}),
    ...(input.rules?.numbers ? { numbers: input.rules.numbers } : {}),
  };
  const markers = input.rules?.visualElements === 'markers';
  const layout = input.layout ?? layoutFromText(input.extractedText ?? '');

  // Códigos e colunas de identificadores ficam como no original (ADR-013); medidas só trocam o separador decimal.
  const kept: Set<object> = keptCells(layout.blocks, (cell) => cell.text);
  // Sem letras (datas, notas, números) ou medida: converte formatos; código com letras: exatamente como no original.
  const keep = (text: string) =>
    !hasLetters(text) || isMeasurement(text) ? withGlossaryOnly(prepareSegment(text, from, to, segmentRules), input.glossary) : text;

  // Trechos a traduzir, na ordem do documento (nomes em assinaturas não são traduzidos).
  const segments: string[] = [];
  const collect = (text: string | null | undefined) => {
    if (text && text.trim()) segments.push(text);
  };
  for (const block of layout.blocks) {
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row.cells) !kept.has(cell) && collect(cell.text);
    else if (block.kind === 'signature') collect(block.role);
    else collect(block.text);
  }
  for (const note of layout.notes) if ('quote' in note) collect(note.quote);
  const originals = [...new Set(segments)];
  // Nomes de pessoas, cidades e endereços do documento inteiro: a mesma cidade aparece com e sem a sigla do estado.
  const properNouns = properNounsOf(originals);

  const memory = await input.memory(originals.map(memoryKey));
  const translations = new Map<string, Translated>();
  const pending: Array<{ original: string; prepared: string; text: string; restore: (value: string) => string | null }> = [];
  for (const original of originals) {
    const remembered = memory.get(memoryKey(original));
    if (remembered !== undefined) {
      translations.set(original, { text: remembered, origin: 'memory' });
      continue;
    }
    if (isCodeLike(original)) {
      translations.set(original, { text: keep(original), origin: 'rules' });
      continue;
    }
    const prepared = prepareSegment(original, from, to, segmentRules);
    const plain = withGlossaryOnly(prepared, input.glossary);
    if (!hasLetters(prepared) || !input.translator) {
      // Sem letras não há o que traduzir; sem provedor, fica o texto preparado para o revisor.
      translations.set(original, { text: plain, origin: 'rules' });
      continue;
    }
    pending.push({ original, prepared: plain, ...guardForTranslation(prepared, to, input.glossary, properNouns) });
  }

  let characters = 0;
  if (pending.length && input.translator) {
    characters = pending.reduce((sum, item) => sum + item.text.length, 0);
    const translated = await input.translator.translate(
      pending.map((item) => item.text),
      from,
      to,
    );
    pending.forEach((item, index) => {
      // O provedor troca o travessão do original (–) por outro (—); o modelo mantém o do original.
      const restored = item.restore(translated[index] ?? '')?.replace(/—/g, item.original.includes('—') ? '—' : '–') ?? null;
      // Marcador perdido pelo provedor: o trecho fica sem tradução para o revisor, nunca com número faltando.
      translations.set(item.original, restored === null ? { text: item.prepared, origin: 'rules' } : { text: restored, origin: 'machine' });
    });
  }

  const lookup = (original: string): Translated => translations.get(original) ?? { text: original, origin: 'rules' };
  const merge = (origins: Translated['origin'][]): DraftBlock['origin'] =>
    origins.includes('machine') ? 'machine' : origins.includes('memory') ? 'memory' : 'rules';

  const body: DraftBlock[] = layout.blocks.map((block): DraftBlock => {
    switch (block.kind) {
      case 'table': {
        const origins: Translated['origin'][] = [];
        const rows = block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => {
            if (!cell.text.trim()) return { ...cell, sourceText: cell.sourceText ?? null };
            if (kept.has(cell)) return { ...cell, text: keep(cell.text), sourceText: cell.text };
            const result = lookup(cell.text);
            origins.push(result.origin);
            return { ...cell, text: result.text, sourceText: cell.text };
          }),
        }));
        return { ...block, rows, origin: merge(origins) };
      }
      case 'signature': {
        const role = block.role ? lookup(block.role) : null;
        return {
          ...block,
          role: role?.text ?? '',
          sourceText: [block.name, block.role].filter(Boolean).join(' – '),
          origin: role ? merge([role.origin]) : 'rules',
        };
      }
      default: {
        // Rótulo de elemento visual sozinho ("BRASÃO", "QR CODE"): só o marcador entre colchetes (regra das skills).
        const label = markers && (block.kind === 'paragraph' || block.kind === 'heading') ? visualLabel(block.text, to) : null;
        if (label) return { ...block, text: label, sourceText: block.text, origin: 'rules' };
        const result = lookup(block.text);
        return { ...block, text: result.text, sourceText: block.text, origin: result.origin };
      }
    }
  });

  const quoteOf = (quote: string) => {
    const result = lookup(quote);
    return { translated: result.text, origin: result.origin };
  };
  const notes = (at: 'start' | 'end') =>
    layout.notes
      .filter((note) => note.at === at)
      .map((note): DraftBlock => {
        const quote = 'quote' in note ? quoteOf(note.quote) : null;
        if (markers) {
          // Só o marcador entre colchetes (ADR-015); o rodapé é conteúdo e sai como texto traduzido.
          const footer = note.kind === 'footer';
          return {
            kind: 'paragraph',
            text: markerText(note, to, quote?.translated ?? ''),
            align: footer ? 'center' : 'left',
            bold: false,
            size: footer ? 'small' : 'normal',
            sourceText: footer ? note.quote : null,
            origin: quote ? merge([quote.origin]) : 'rules',
          };
        }
        return {
          kind: 'translator_note',
          text: noteText(note, to, quote?.translated ?? ''),
          sourceText: 'quote' in note ? note.quote : null,
          origin: quote ? merge([quote.origin]) : 'rules',
        };
      });

  const blocks = [...notes('start'), ...body, ...notes('end')];
  const translatedTitle = layout.title ? lookup(layout.title) : null;
  const values = [...translations.values()];
  return {
    draft: {
      sourceLanguage: from,
      targetLanguage: to,
      // Tipo: o do exemplo aprovado; senão, o título traduzido pelo provedor (sem o original entre colchetes).
      documentType:
        input.known?.documentType ??
        (translatedTitle && translatedTitle.origin !== 'rules'
          ? stripEmphasis(translatedTitle.text)
              .replace(/\s*\[[^\]]*\]\s*/g, ' ')
              .trim()
              .toUpperCase()
          : ''),
      sourceTitle: input.known?.sourceTitle ?? (layout.title ? stripEmphasis(layout.title) : ''),
      blocks,
    },
    stats: {
      segments: originals.length,
      fromMemory: values.filter((value) => value.origin === 'memory').length,
      translated: values.filter((value) => value.origin === 'machine').length,
      characters,
    },
  };
}

/** Pares (original → tradução aprovada) de um rascunho aprovado, para a memória de tradução. */
export function memoryPairs(draft: Draft) {
  const pairs = new Map<string, string>();
  const add = (source: string | null | undefined, target: string) => {
    if (!source || !target.trim() || !hasLetters(source)) return;
    pairs.set(memoryKey(source), target.trim());
  };
  for (const block of draft.blocks) {
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row.cells) add(cell.sourceText, cell.text);
    else if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'section') add(block.sourceText, block.text);
    else if (block.kind === 'signature' && block.sourceText?.startsWith(`${block.name} – `))
      add(block.sourceText.slice(block.name.length + 3), block.role);
    else if (block.kind === 'translator_note' && block.sourceText)
      add(block.sourceText, noteTranslation(block.text, block.sourceText) ?? '');
  }
  return pairs;
}

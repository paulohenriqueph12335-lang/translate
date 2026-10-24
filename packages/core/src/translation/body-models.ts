import type { Draft, DraftBlock, Language, TableCell, TableRow } from './draft.js';

/**
 * Modelos de corpo da tradução juramentada por tipo de documento (ADR-019). O conteúdo traduzido segue o original,
 * mas ganha uma organização previsível: tabelas que fecham as colunas, rótulo e valor alinhados em certidões e
 * documentos de identidade, sem parágrafos vazios sobrando, e o tipo do documento sempre preenchido.
 */

export const BODY_MODELS = [
  'birth_certificate',
  'marriage_certificate',
  'death_certificate',
  'identity',
  'driver_license',
  'school_record',
  'diploma',
  'apostille',
  'professional_certificate',
  'contract',
  'invoice',
  'generic',
] as const;
export type BodyModel = (typeof BODY_MODELS)[number];

interface ModelSpec {
  label: string;
  /** Palavras do título ou do texto do original que identificam o tipo (sem acento, maiúsculas). */
  keywords: RegExp;
  /** Rótulo e valor (certidões, identidade): linhas "Rótulo: valor" viram tabela de duas colunas. */
  keyValue: boolean;
  /** Tipo do documento no idioma de destino, quando o original não traz título. */
  type: Record<Language, string>;
}

export const BODY_MODEL_SPECS: Record<BodyModel, ModelSpec> = {
  birth_certificate: {
    label: 'Certidão de nascimento',
    keywords:
      /CERTIDAO DE NASCIMENTO|REGISTRO DE NASCIMENTO|BIRTH CERTIFICATE|ACTE DE NAISSANCE|(?:ATTO|CERTIFICATO) DI NASCITA|ACTA DE NACIMIENTO/,
    keyValue: true,
    type: {
      en: 'BIRTH CERTIFICATE',
      pt: 'CERTIDÃO DE NASCIMENTO',
      fr: 'ACTE DE NAISSANCE',
      it: 'CERTIFICATO DI NASCITA',
      es: 'ACTA DE NACIMIENTO',
    },
  },
  marriage_certificate: {
    label: 'Certidão de casamento',
    keywords: /CERTIDAO DE CASAMENTO|MARRIAGE CERTIFICATE|ACTE DE MARIAGE|(?:ATTO|CERTIFICATO) DI MATRIMONIO|ACTA DE MATRIMONIO/,
    keyValue: true,
    type: {
      en: 'MARRIAGE CERTIFICATE',
      pt: 'CERTIDÃO DE CASAMENTO',
      fr: 'ACTE DE MARIAGE',
      it: 'CERTIFICATO DI MATRIMONIO',
      es: 'ACTA DE MATRIMONIO',
    },
  },
  death_certificate: {
    label: 'Certidão de óbito',
    keywords: /CERTIDAO DE OBITO|DEATH CERTIFICATE|ACTE DE DECES|(?:ATTO|CERTIFICATO) DI MORTE|ACTA DE DEFUNCION/,
    keyValue: true,
    type: { en: 'DEATH CERTIFICATE', pt: 'CERTIDÃO DE ÓBITO', fr: 'ACTE DE DÉCÈS', it: 'CERTIFICATO DI MORTE', es: 'ACTA DE DEFUNCIÓN' },
  },
  identity: {
    label: 'Identidade (CIN, RG)',
    keywords:
      /CARTEIRA DE IDENTIDADE|REGISTRO GERAL|CEDULA DE IDENTIDADE|IDENTITY CARD|CARTE D.IDENTITE|CARTA D.IDENTITA|DOCUMENTO DE IDENTIDAD/,
    keyValue: true,
    type: {
      en: 'IDENTITY CARD',
      pt: 'CARTEIRA DE IDENTIDADE',
      fr: "CARTE D'IDENTITÉ",
      it: "CARTA D'IDENTITÀ",
      es: 'DOCUMENTO DE IDENTIDAD',
    },
  },
  driver_license: {
    label: 'Carteira de motorista (CNH)',
    keywords:
      /CARTEIRA NACIONAL DE HABILITACAO|PERMISSAO PARA DIRIGIR|DRIVER.S LICEN[CS]E|DRIVING LICEN[CS]E|PERMIS DE CONDUIRE|PATENTE DI GUIDA|LICENCIA DE CONDUCIR/,
    keyValue: true,
    type: {
      en: 'DRIVING LICENCE',
      pt: 'CARTEIRA NACIONAL DE HABILITAÇÃO',
      fr: 'PERMIS DE CONDUIRE',
      it: 'PATENTE DI GUIDA',
      es: 'LICENCIA DE CONDUCIR',
    },
  },
  school_record: {
    label: 'Histórico escolar',
    keywords: /HISTORICO ESCOLAR|HISTORICO ACADEMICO|TRANSCRIPT|RELEVE DE NOTES|CERTIFICATO DEGLI ESAMI|CERTIFICADO DE ESTUDIOS/,
    keyValue: false,
    type: {
      en: 'SCHOOL TRANSCRIPT',
      pt: 'HISTÓRICO ESCOLAR',
      fr: 'RELEVÉ DE NOTES',
      it: 'CERTIFICATO DEGLI ESAMI',
      es: 'CERTIFICADO DE ESTUDIOS',
    },
  },
  diploma: {
    label: 'Diploma',
    keywords: /\bDIPLOM[AE]\b|CERTIFICADO DE CONCLUSAO/,
    keyValue: false,
    type: { en: 'DIPLOMA', pt: 'DIPLOMA', fr: 'DIPLÔME', it: 'DIPLOMA', es: 'DIPLOMA' },
  },
  apostille: {
    label: 'Apostila',
    keywords: /\bAPOSTIL(A|LA|LE)\b|CONVENCAO DA HAIA|CONVENTION DE LA HAYE/,
    keyValue: false,
    type: { en: 'APOSTILLE', pt: 'APOSTILA', fr: 'APOSTILLE', it: 'APOSTILLE', es: 'APOSTILLA' },
  },
  professional_certificate: {
    label: 'Certidão de conselho profissional',
    keywords:
      /CONSELHO (REGIONAL|FEDERAL|FICTICIO) DE|CERTIDAO DE (INSCRICAO|REGULARIDADE)|CERTIFICATE OF REGISTRATION|CERTIFICAT D.INSCRIPTION|CERTIFICATO DI ISCRIZIONE|CERTIFICADO DE INSCRIPCION/,
    keyValue: true,
    type: {
      en: 'CERTIFICATE OF REGISTRATION',
      pt: 'CERTIDÃO DE INSCRIÇÃO',
      fr: "CERTIFICAT D'INSCRIPTION",
      it: 'CERTIFICATO DI ISCRIZIONE',
      es: 'CERTIFICADO DE INSCRIPCIÓN',
    },
  },
  contract: {
    label: 'Contrato',
    keywords: /\bCONTRATO\b|CLAUSULA|CONTRATANTE|CONTRACT\b|CONTRAT\b|CONTRATTO/,
    keyValue: false,
    type: { en: 'CONTRACT', pt: 'CONTRATO', fr: 'CONTRAT', it: 'CONTRATTO', es: 'CONTRATO' },
  },
  invoice: {
    label: 'Fatura e extrato',
    keywords: /FATURA|EXTRATO|INVOICE|STATEMENT OF ACCOUNT|FACTURE|FATTURA|FACTURA/,
    keyValue: true,
    type: { en: 'STATEMENT', pt: 'FATURA', fr: 'FACTURE', it: 'FATTURA', es: 'FACTURA' },
  },
  generic: {
    label: 'Documento geral',
    keywords: /$^/,
    keyValue: false,
    type: { en: 'DOCUMENT', pt: 'DOCUMENTO', fr: 'DOCUMENT', it: 'DOCUMENTO', es: 'DOCUMENTO' },
  },
};

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

/** Tipo do documento pelo título e pelo começo do texto do original. */
export function classifyDocument(draft: Draft, sourceText: string | null): BodyModel {
  // Só o título e as primeiras linhas: o corpo cita outros documentos (um atestado traz o CRM do médico).
  const head = fold([draft.sourceTitle, ...(sourceText ?? '').split('\n').slice(0, 8)].join('\n'));
  // A ordem importa: apostila e conselho citam "certidão" do documento apostilado.
  const order: BodyModel[] = [
    'apostille',
    'professional_certificate',
    'driver_license',
    'identity',
    'birth_certificate',
    'marriage_certificate',
    'death_certificate',
    'school_record',
    'diploma',
    'invoice',
    'contract',
  ];
  return order.find((model) => BODY_MODEL_SPECS[model].keywords.test(head)) ?? 'generic';
}

/** Evidência explicável das mesmas regras usadas na diagramação; a pontuação não é probabilidade estatística. */
export function suggestDocumentCategory(draft: Draft, sourceText: string | null) {
  const category = classifyDocument(draft, sourceText);
  if (category === 'generic') return { category, confidence: 0, basis: 'unrecognized' as const };
  const title = fold(draft.sourceTitle);
  const titleMatch = BODY_MODEL_SPECS[category].keywords.test(title);
  const candidates = BODY_MODELS.filter((model) => model !== 'generic' && BODY_MODEL_SPECS[model].keywords.test(title));
  return {
    category,
    confidence: titleMatch ? (candidates.length > 1 ? 80 : 95) : 70,
    basis: titleMatch ? ('title' as const) : ('opening_text' as const),
  };
}

type Table = Extract<DraftBlock, { kind: 'table' }>;

/** Linhas que não fecham a grade de uma tabela (mesma conta da checagem de estrutura). */
function tableProblems(block: Table) {
  const width = block.columns.length;
  let carried = new Array<number>(width).fill(0);
  let broken = 0;
  block.rows.forEach((row) => {
    const occupied = carried.filter((rows) => rows > 0).length;
    const used = occupied + row.cells.reduce((sum, cell) => sum + Math.max(1, cell.colSpan), 0);
    if (used !== width) broken += 1;
    const next = carried.map((rows) => (rows > 0 ? rows - 1 : 0));
    let column = 0;
    for (const cell of row.cells) {
      while (column < width && carried[column]! > 0) column += 1;
      for (let span = 0; span < cell.colSpan && column < width; span += 1, column += 1) next[column] = Math.max(0, cell.rowSpan - 1);
    }
    carried = next;
  });
  if (carried.some((rows) => rows > 0)) broken += 1;
  return broken;
}

/**
 * Tabela que não fecha a grade (formulários com grade de muitas colunas, mesclagens que não batem): ajusta as
 * mesclagens linha a linha; se ainda assim não fecha, refaz a tabela com uma coluna por célula, sem mesclas
 * verticais. Nenhum texto é perdido; só a geometria muda.
 */
export function repairTable(block: Table): Table | null {
  if (!tableProblems(block)) return null;
  const width = block.columns.length;
  const rowsLeft = block.rows.length;
  // 1. Ajuste das mesclagens dentro da grade existente.
  let carried = new Array<number>(width).fill(0);
  let fits = true;
  const rows: TableRow[] = block.rows.map((row, rowIndex) => {
    const free = width - carried.filter((rows) => rows > 0).length;
    const cells: TableCell[] = row.cells.map((cell) => ({
      ...cell,
      colSpan: Math.max(1, cell.colSpan),
      rowSpan: Math.max(1, Math.min(cell.rowSpan, rowsLeft - rowIndex)),
    }));
    if (cells.length > free) fits = false;
    else if (cells.length) {
      const total = cells.reduce((sum, cell) => sum + cell.colSpan, 0);
      if (total !== free) {
        // Mesclas proporcionais ao que cada célula ocupava; a última fecha a linha.
        let used = 0;
        cells.forEach((cell, index) => {
          const remainingCells = cells.length - index - 1;
          const share = index === cells.length - 1 ? free - used : Math.max(1, Math.round((cell.colSpan / total) * free));
          cell.colSpan = Math.max(1, Math.min(share, free - used - remainingCells));
          used += cell.colSpan;
        });
      }
    }
    const next = carried.map((rows) => (rows > 0 ? rows - 1 : 0));
    let column = 0;
    for (const cell of cells) {
      while (column < width && carried[column]! > 0) column += 1;
      for (let span = 0; span < cell.colSpan && column < width; span += 1, column += 1) next[column] = cell.rowSpan - 1;
    }
    carried = next;
    return { ...row, cells };
  });
  const adjusted: Table = { ...block, rows };
  if (fits && !tableProblems(adjusted)) return adjusted;

  // 2. Refaz: tantas colunas quanto a linha mais cheia; cada linha ocupa a largura toda.
  const columns = Math.max(1, ...block.rows.map((row) => row.cells.length));
  return {
    ...block,
    columns: new Array<number>(columns).fill(1),
    rows: block.rows.map((row) => ({
      ...row,
      cells: row.cells.length
        ? row.cells.map((cell, index) => ({
            ...cell,
            rowSpan: 1,
            colSpan: index === row.cells.length - 1 ? columns - (row.cells.length - 1) : 1,
          }))
        : [{ text: '', sourceText: null, colSpan: columns, rowSpan: 1, bold: false, align: 'left' as const }],
    })),
  };
}

const LABEL_VALUE = /^(\*\*)?([\p{L}][\p{L}\s()./º°ª-]{1,40}?)(\*\*)?\s*:\s+(.+)$/u;

/** Parágrafo "Rótulo: valor" (rótulo curto, até cinco palavras). */
function splitLabel(text: string) {
  const match = LABEL_VALUE.exec(text.trim());
  if (!match) return null;
  const label = match[2]!.trim();
  if (label.split(/\s+/).length > 5 || /https?$/i.test(label)) return null;
  return { label, value: match[4]!.trim() };
}

export interface BodyModelResult {
  draft: Draft;
  model: BodyModel;
  /** O que o modelo mudou, para o registro da revisão automática. */
  changes: Array<{ block: number; message: string; before: string; after: string }>;
}

/** Aplica o modelo de corpo: tabelas que fecham, rótulo e valor alinhados, espaçamento limpo e tipo preenchido. */
export function applyBodyModel(input: Draft, sourceText: string | null, model = classifyDocument(input, sourceText)): BodyModelResult {
  const spec = BODY_MODEL_SPECS[model];
  const draft: Draft = structuredClone(input);
  const changes: BodyModelResult['changes'] = [];

  // Tabelas que não fecham a grade.
  draft.blocks = draft.blocks.map((block, index) => {
    if (block.kind !== 'table') return block;
    const repaired = repairTable(block);
    if (!repaired) return block;
    changes.push({
      block: index + 1,
      message: `Tabela reorganizada para fechar as colunas (${repaired.columns.length} coluna(s))`,
      before: `${block.columns.length} coluna(s), ${tableProblems(block)} linha(s) fora da grade`,
      after: `${repaired.columns.length} coluna(s), linhas completas`,
    });
    return repaired;
  });

  // Espaçamento: sem parágrafos vazios e sem linha de assinatura repetida em sequência.
  const before = draft.blocks.length;
  draft.blocks = draft.blocks.filter((block, index, all) => {
    if (block.kind === 'paragraph' && !block.text.trim()) return false;
    const previous = all[index - 1];
    return !(
      block.kind === 'paragraph' &&
      /^_{5,}$/.test(block.text.trim()) &&
      previous?.kind === 'paragraph' &&
      /^_{5,}$/.test(previous.text.trim())
    );
  });
  if (draft.blocks.length !== before) {
    changes.push({
      block: 0,
      message: 'Parágrafos vazios removidos',
      before: `${before} bloco(s)`,
      after: `${draft.blocks.length} bloco(s)`,
    });
  }

  // Rótulo e valor: sequências de duas ou mais linhas "Rótulo: valor" viram tabela de duas colunas (35% / 65%).
  if (spec.keyValue) {
    const blocks: DraftBlock[] = [];
    let run: Array<Extract<DraftBlock, { kind: 'paragraph' }>> = [];
    const flush = () => {
      if (run.length >= 2) {
        const pairs = run.map((block) => ({ block, ...splitLabel(block.text)! }));
        blocks.push({
          kind: 'table',
          columns: [35, 65],
          rows: pairs.map(({ block, label, value }) => {
            const source = block.sourceText ? splitLabel(block.sourceText) : null;
            return {
              style: 'normal',
              cells: [
                { text: label, sourceText: source?.label ?? null, colSpan: 1, rowSpan: 1, bold: true, align: 'left' },
                { text: value, sourceText: source?.value ?? null, colSpan: 1, rowSpan: 1, bold: false, align: 'left' },
              ],
            };
          }),
          sourceText: run.map((block) => block.sourceText ?? '').join('\n') || null,
          origin: run[0]!.origin,
        });
        changes.push({
          block: blocks.length,
          message: `${run.length} linhas "rótulo: valor" alinhadas em tabela`,
          before: run.map((block) => block.text).join(' | '),
          after: 'tabela de duas colunas',
        });
      } else blocks.push(...run);
      run = [];
    };
    for (const block of draft.blocks) {
      if (block.kind === 'paragraph' && !block.bold && splitLabel(block.text)) run.push(block);
      else {
        flush();
        blocks.push(block);
      }
    }
    flush();
    draft.blocks = blocks;
  }

  // Tipo do documento: o do modelo (ou o primeiro título) quando o rascunho não tem.
  // No modelo geral, só com título no original; sem ele, a diagramação construída (ADR-020) reconhece o título.
  const title = draft.blocks.find((block) => block.kind === 'heading' && block.text.trim()) as
    | Extract<DraftBlock, { kind: 'heading' }>
    | undefined;
  if (!draft.documentType.trim() && (model !== 'generic' || title)) {
    const fallback = model !== 'generic' ? spec.type[draft.targetLanguage] : title!.text.replace(/\*\*/g, '').trim().toUpperCase();
    draft.documentType = fallback.slice(0, 200);
    if (!draft.sourceTitle.trim() && title?.sourceText) draft.sourceTitle = title.sourceText.replace(/\*\*/g, '').trim();
    changes.push({ block: 0, message: `Tipo do documento preenchido pelo modelo "${spec.label}"`, before: '', after: draft.documentType });
  }
  return { draft, model, changes };
}

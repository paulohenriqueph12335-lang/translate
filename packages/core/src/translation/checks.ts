import { convertNumericDate, numericDateToLong, swapNumberSeparators } from './conventions.js';
import { isCodeLike, keptCells } from './codes.js';
import { structuralProblems, type Draft } from './draft.js';

/** Problema encontrado por checagem determinística; aparece para o revisor e só é superado por decisão humana (ADR-007). */
export interface DraftIssue {
  severity: 'error' | 'warning';
  code:
    | 'structure'
    | 'number_missing'
    | 'glossary_not_applied'
    | 'empty_block'
    | 'missing_document_type'
    | 'missing_source_title'
    | 'untranslated'
    | 'translator_note';
  message: string;
  /** Trecho do original que motivou o problema, quando houver. */
  token?: string;
}

export interface GlossaryTerm {
  source: string;
  target: string;
}

/** Todo o texto visível do rascunho, para buscas. */
export function draftText(draft: Draft) {
  const parts: string[] = [draft.documentType];
  for (const block of draft.blocks) {
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row.cells) parts.push(cell.text);
    else if (block.kind === 'signature') parts.push(block.name, block.role);
    else parts.push(block.text);
  }
  return stripEmphasis(parts.join('\n'));
}

/** Remove a marcação de ênfase (`**`) para comparar apenas o texto. */
export const stripEmphasis = (text: string) => text.replace(/\*\*/g, '');

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

const comparable = (text: string) => normalize(stripEmphasis(text)).trim();

/**
 * Trechos com original conhecido (com letras) e quantos continuam iguais ao original. Nomes e endereços ficam
 * iguais por natureza; a maioria igual indica rascunho sem tradução.
 */
export function untranslatedShare(draft: Draft) {
  let total = 0;
  let same = 0;
  // Códigos e colunas de identificadores ficam iguais ao original por definição (ADR-013) e não contam.
  const count = (source: string | null | undefined, text: string) => {
    if (!source || !/\p{L}{2}/u.test(source) || isCodeLike(source)) return;
    total += 1;
    if (comparable(source) === comparable(text)) same += 1;
  };
  const kept = keptCells(draft.blocks, (cell) => cell.sourceText ?? '');
  for (const block of draft.blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) for (const cell of row.cells) if (!kept.has(cell)) count(cell.sourceText, cell.text);
    } else if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'section') count(block.sourceText, block.text);
  }
  return { total, same };
}

/** Números relevantes do original: datas, notas, cargas horárias, registros. Inteiros curtos isolados são ruído. */
export function numericTokens(text: string) {
  const tokens = text.match(/\d+(?:[.,/-]\d+)*/g) ?? [];
  return [...new Set(tokens.filter((token) => token.length >= 3 || /[.,]/.test(token)))];
}

/**
 * Checagens do rascunho contra o texto extraído do original:
 * estrutura das tabelas, números e datas presentes (no formato original ou convertido) e glossário aplicado.
 */
export function checkDraft(
  draft: Draft,
  sourceText: string | null,
  glossary: GlossaryTerm[] = [],
  rules: { visualElements?: 'markers' | 'translator_notes' } = {},
): DraftIssue[] {
  const issues: DraftIssue[] = structuralProblems(draft).map((message) => ({ severity: 'error', code: 'structure', message }));
  // Regra das skills (ADR-015): nenhuma nota do tradutor; elementos visuais só como marcador entre colchetes.
  if (rules.visualElements === 'markers') {
    draft.blocks.forEach((block, index) => {
      if (block.kind === 'translator_note')
        issues.push({
          severity: 'error',
          code: 'translator_note',
          message: `Bloco ${index + 1}: nota do tradutor não é permitida nesta modalidade; use só o marcador entre colchetes (ex.: [Carimbo])`,
        });
    });
  }
  const target = draftText(draft);
  if (!draft.documentType.trim()) {
    issues.push({ severity: 'error', code: 'missing_document_type', message: 'Informe o tipo de documento (linha "DOCUMENT TYPE")' });
  }
  if (!draft.sourceTitle.trim()) {
    issues.push({
      severity: 'warning',
      code: 'missing_source_title',
      message: 'Informe o título do documento original (ex.: "HISTÓRICO ESCOLAR") para o sistema aprender este tipo de documento',
    });
  }

  const share = untranslatedShare(draft);
  if (share.total >= 4 && share.same / share.total > 0.5) {
    issues.push({
      severity: 'error',
      code: 'untranslated',
      message: `A maior parte do texto ainda está igual ao original (${share.same} de ${share.total} trechos): traduza antes de aprovar`,
    });
  }

  draft.blocks.forEach((block, index) => {
    const empty = block.kind === 'table' ? block.rows.length === 0 : block.kind === 'signature' ? !block.name.trim() : !block.text.trim();
    if (empty) issues.push({ severity: 'warning', code: 'empty_block', message: `Bloco ${index + 1} está vazio` });
  });

  if (sourceText) {
    for (const token of numericTokens(sourceText)) {
      const variants = new Set([
        token,
        swapNumberSeparators(token),
        convertNumericDate(token, draft.sourceLanguage, draft.targetLanguage),
        // Data escrita por extenso no idioma de destino (regra das skills).
        numericDateToLong(token, draft.sourceLanguage, draft.targetLanguage),
      ]);
      if (![...variants].some((variant) => target.includes(variant))) {
        issues.push({
          severity: 'error',
          code: 'number_missing',
          message: `Número do original não encontrado na tradução: ${token}`,
          token,
        });
      }
    }
    const source = normalize(sourceText);
    const translated = normalize(target);
    for (const term of glossary) {
      if (source.includes(normalize(term.source)) && !translated.includes(normalize(term.target))) {
        issues.push({
          severity: 'warning',
          code: 'glossary_not_applied',
          message: `Glossário: "${term.source}" deveria ser traduzido como "${term.target}"`,
          token: term.source,
        });
      }
    }
  }
  return issues;
}

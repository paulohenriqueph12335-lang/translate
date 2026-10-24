import { checkDraft, type DraftIssue, type GlossaryTerm } from '../translation/checks.js';
import type { Draft, Language } from '../translation/draft.js';
import { extractOfficeText } from '../translation/extract-office.js';
import { extractPdfText } from '../translation/extract-pdf.js';
import { analyzeDocxLayout } from '../translation/layout/docx-layout.js';
import { analyzePdfLayout } from '../translation/layout/pdf-layout.js';
import type { SourceLayout } from '../translation/layout/source-layout.js';
import { buildMachineDraft, type MachineDraftResult, type MemoryLookup } from '../translation/machine/machine-draft.js';
import { MachineTranslationFailed, type MachineTranslator } from '../translation/machine/providers.js';
import type { TranslationRules } from '../translation/profiles.js';
import { autoReview, type Correction } from '../translation/review.js';
import { applyBodyModel, BODY_MODEL_SPECS, type BodyModel } from '../translation/body-models.js';
import { composeLayout, layoutIsUnknown, type LayoutSample } from '../translation/layout-composer.js';
import { ocrDocument } from '../translation/ocr.js';
import { buildManualDraft } from './manual-draft.js';

/**
 * Do arquivo ao rascunho revisado (ADR-016), sem banco: extração, layout, tradução gratuita, revisão automática e
 * checagens. O worker usa para processar a fila; o teste de padrões usa para dizer se o sistema dá conta de um
 * documento novo sem criar tradução.
 */

export interface Extraction {
  text: string;
  pages: number | null;
  hasTextLayer: boolean;
  rotatedText: string[];
  /** Texto reconhecido por OCR (imagem ou PDF digitalizado), com a confiança média (ADR-018). */
  ocr?: { confidence: number };
}

/**
 * Texto do arquivo: a camada de texto do PDF, o conteúdo do DOCX/PPTX e, sem texto (imagem ou PDF digitalizado), o
 * OCR local. Sem Tesseract instalado, imagens e digitalizados seguem sem texto, como antes.
 */
export async function extractFile(data: Uint8Array, format: string, source: Language = 'pt'): Promise<Extraction | null> {
  // O pdf.js toma posse do buffer: cada leitura recebe a sua cópia.
  const direct =
    format === 'pdf'
      ? await extractPdfText(data.slice())
      : format === 'docx' || format === 'pptx'
        ? { ...(await extractOfficeText(data.slice(), format)), pages: null, rotatedText: [] }
        : null;
  if (direct?.hasTextLayer || (format !== 'pdf' && format !== 'png' && format !== 'jpeg')) return direct;
  const ocr = await ocrDocument(data.slice(), format, source);
  if (!ocr) return direct;
  return {
    text: ocr.text,
    pages: direct?.pages ?? ocr.pages,
    hasTextLayer: ocr.text.replace(/\s/g, '').length > 40,
    rotatedText: [],
    ocr: { confidence: ocr.confidence },
  };
}

export interface DraftInput {
  data: Uint8Array;
  format: string;
  extraction: Extraction | null;
  sourceLanguage: Language;
  targetLanguage: Language;
  rules: TranslationRules;
  glossary: GlossaryTerm[];
  memory: MemoryLookup;
  known: { documentType: string; sourceTitle: string } | null;
  /** `null`: sem tradução automática (desligada, fora do ar ou tradução manual). */
  translator: MachineTranslator | null;
  /** Por que não há tradutor, para o aviso; `undefined` quando há. */
  noTranslatorNotice?: string;
  /** O que as traduções concluídas ensinam de diagramação (ADR-020), para documentos ainda desconhecidos. */
  knowledge?: LayoutSample[];
  /** Escolha humana do tipo; omitida mantém a identificação pelas regras do original. */
  documentCategory?: BodyModel;
}

export interface DraftOutput {
  extractedText: string | null;
  layout: SourceLayout | null;
  draft: Draft;
  origin: 'machine' | 'manual';
  notice: string | null;
  stats: MachineDraftResult['stats'] | null;
  /** Falha do provedor; quem chama decide se tenta de novo (o rascunho já vem sem tradução automática). */
  machineFailure: MachineTranslationFailed | null;
  corrections: Correction[];
  unresolved: string[];
  issues: DraftIssue[];
  /** Modelo de corpo aplicado pelo tipo do documento (ADR-019). */
  bodyModel: BodyModel;
  /** Documentos conhecidos combinados para diagramar um documento novo (ADR-020). */
  composedFrom: Array<{ title: string; similarity: number }>;
}

export async function draftFromFile(input: DraftInput): Promise<DraftOutput> {
  const { data, format, extraction, sourceLanguage, targetLanguage, rules, glossary, memory, known } = input;
  const extractedText = extraction?.hasTextLayer ? extraction.text : null;
  // Estrutura do original (ADR-009): tabelas, títulos, assinaturas e notas; a tradução preenche essa estrutura.
  const layout =
    format === 'pdf' && extractedText && !extraction?.ocr
      ? await analyzePdfLayout(data.slice()).catch(() => null)
      : format === 'docx'
        ? await analyzeDocxLayout(data.slice()).catch(() => null)
        : null;
  const base = { sourceLanguage, targetLanguage, extractedText, layout, glossary, memory, known, rules };

  let draft: Draft | null = null;
  let origin: 'machine' | 'manual' = 'manual';
  let notice: string | null = null;
  let stats: MachineDraftResult['stats'] | null = null;
  let machineFailure: MachineTranslationFailed | null = null;
  let reviewTranslator = input.translator;

  if (extractedText && input.translator) {
    try {
      const result = await buildMachineDraft({ ...base, translator: input.translator });
      draft = result.draft;
      origin = 'machine';
      stats = result.stats;
      notice =
        `Traduzido automaticamente (${input.translator.name === 'deepl' ? 'DeepL' : 'LibreTranslate'}): ` +
        `${result.stats.translated} trecho(s) traduzido(s) e ${result.stats.fromMemory} reaproveitado(s) de traduções concluídas.`;
    } catch (error) {
      if (!(error instanceof MachineTranslationFailed)) throw error;
      machineFailure = error;
      reviewTranslator = null;
      notice = `A tradução automática falhou (${error.message}): o rascunho traz o texto original para ser traduzido.`;
    }
  } else if (extractedText && input.noTranslatorNotice) {
    notice = input.noTranslatorNotice;
  }

  // Rascunho sem tradução automática: sempre explica por quê, para não parecer erro.
  if (!draft && !notice) {
    notice =
      format === 'jpeg' || format === 'png'
        ? 'Imagem: o sistema ainda não lê texto de imagens; transcreva e traduza a partir do original.'
        : 'O arquivo não tem texto que o sistema consiga ler; transcreva e traduza a partir do original.';
  }
  // Sem tradução automática, o rascunho mantém a estrutura do original (ADR-009) com o texto preparado e a memória.
  draft ??= layout?.blocks.length
    ? (await buildMachineDraft({ ...base, translator: null })).draft
    : buildManualDraft({ sourceLanguage, targetLanguage, extractedText, glossary });

  if (extraction?.ocr && extractedText) {
    notice =
      `Texto lido por OCR (confiança média ${extraction.ocr.confidence}%): confira nomes, números e datas com o original. ${notice ?? ''}`.trim();
  }
  // Modelo de corpo pelo tipo do documento (ADR-019): tabelas que fecham, rótulo e valor, espaçamento e tipo.
  const body = applyBodyModel(draft, extractedText, input.documentCategory);
  const layoutChanges: Correction[] = body.changes.map((change) => ({ code: 'layout', ...change }));
  // Documento sem modelo próprio, sem exemplo do mesmo tipo ou sem formatação no original (OCR): a diagramação é
  // construída combinando os documentos conhecidos de estrutura mais parecida (ADR-020).
  let composedFrom: DraftOutput['composedFrom'] = [];
  let shaped = body.draft;
  if (input.knowledge?.length && (body.model === 'generic' || !known || layoutIsUnknown(body.draft))) {
    const composed = composeLayout(body.draft, input.knowledge);
    shaped = composed.draft;
    composedFrom = composed.borrowedFrom;
    layoutChanges.push(...composed.changes.map((change) => ({ code: 'layout' as const, ...change })));
  }
  if (!shaped.documentType.trim()) {
    shaped = { ...shaped, documentType: BODY_MODEL_SPECS.generic.type[shaped.targetLanguage] };
    layoutChanges.push({
      code: 'layout',
      block: 0,
      message: 'Tipo do documento genérico: o original não tem título reconhecível',
      before: '',
      after: shaped.documentType,
    });
  }
  // Revisão automática (ADR-016): corrige idioma, números, datas, glossário e marcadores.
  const review = await autoReview({ draft: shaped, sourceText: extractedText, glossary, rules, translator: reviewTranslator });
  review.corrections.unshift(...layoutChanges);
  if (body.model !== 'generic') notice = `${notice ?? ''} Diagramação pelo modelo "${BODY_MODEL_SPECS[body.model].label}".`.trim();
  if (composedFrom.length && layoutChanges.some((change) => change.message.includes('parecidos'))) {
    const names = composedFrom
      .slice(0, 3)
      .map((item) => `${item.title} (${item.similarity}%)`)
      .join(', ');
    notice = `${notice ?? ''} Diagramação construída combinando documentos conhecidos: ${names}.`.trim();
  }
  if (review.corrections.length) notice = `${notice ?? ''} Revisão automática: ${review.corrections.length} correção(ões) feita(s).`.trim();
  return {
    extractedText,
    layout,
    draft: review.draft,
    origin,
    notice,
    stats,
    machineFailure,
    corrections: review.corrections,
    unresolved: review.unresolved,
    issues: checkDraft(review.draft, extractedText, glossary, rules),
    bodyModel: body.model,
    composedFrom,
  };
}

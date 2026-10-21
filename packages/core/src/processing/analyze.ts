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
}

export async function extractFile(data: Uint8Array, format: string): Promise<Extraction | null> {
  // O pdf.js toma posse do buffer: cada leitura recebe a sua cópia.
  if (format === 'pdf') return extractPdfText(data.slice());
  if (format === 'docx' || format === 'pptx') return { ...(await extractOfficeText(data.slice(), format)), pages: null, rotatedText: [] };
  return null;
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
}

export async function draftFromFile(input: DraftInput): Promise<DraftOutput> {
  const { data, format, extraction, sourceLanguage, targetLanguage, rules, glossary, memory, known } = input;
  const extractedText = extraction?.hasTextLayer ? extraction.text : null;
  // Estrutura do original (ADR-009): tabelas, títulos, assinaturas e notas; a tradução preenche essa estrutura.
  const layout =
    format === 'pdf' && extractedText
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

  // Revisão automática (ADR-016): corrige idioma, números, datas, glossário e marcadores.
  const review = await autoReview({ draft, sourceText: extractedText, glossary, rules, translator: reviewTranslator });
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
  };
}

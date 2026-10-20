import type { GlossaryTerm } from '../translation/checks.js';
import type { Draft, Language } from '../translation/draft.js';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Substitui termos do glossário (sem diferenciar maiúsculas) pela tradução aprovada. */
export function applyGlossary(text: string, glossary: GlossaryTerm[]) {
  // Termos mais longos primeiro, para "Língua Portuguesa" vencer "Língua".
  return [...glossary]
    .sort((left, right) => right.source.length - left.source.length)
    .reduce(
      (current, term) =>
        current.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.source)}(?![\\p{L}\\p{N}])`, 'giu'), term.target),
      text,
    );
}

/**
 * Rascunho para tradução manual (sem layout legível): uma linha do original por bloco, com o glossário aplicado.
 * O revisor traduz o restante e completa o tipo de documento; as checagens apontam o que falta.
 */
export function buildManualDraft(input: {
  sourceLanguage: Language;
  targetLanguage: Language;
  extractedText: string | null;
  glossary: GlossaryTerm[];
}): Draft {
  const lines = (input.extractedText ?? '')
    .split('\n')
    .map((line) => line.replace(/\s{2,}/g, '  ').trim())
    .filter(Boolean);
  const note =
    input.targetLanguage === 'en'
      ? 'The original has no text layer that the system could read: transcribe and translate it from the original file.'
      : 'O original não tem camada de texto legível pelo sistema: transcreva e traduza a partir do arquivo original.';
  return {
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    // Tipo e título do original ficam para o revisor: um palpite errado ensinaria o sistema errado.
    documentType: '',
    sourceTitle: '',
    blocks: lines.length
      ? lines.map((line) => ({
          kind: 'paragraph' as const,
          text: applyGlossary(line, input.glossary),
          align: 'left' as const,
          bold: false,
          size: 'normal' as const,
          sourceText: line,
          origin: 'rules' as const,
        }))
      : [{ kind: 'translator_note' as const, text: note, sourceText: null, origin: 'rules' as const }],
  };
}

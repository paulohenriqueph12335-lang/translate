import { numericTokens, type GlossaryTerm } from './checks.js';
import { isCodeLike } from './codes.js';
import { convertNumericDate, numericDateToLong, swapNumberSeparators } from './conventions.js';
import type { Draft, DraftBlock, Language } from './draft.js';
import { confidentLanguage } from './language-detect.js';
import { guardForTranslation, prepareSegment, properNounsOf, type SegmentRules } from './machine/machine-draft.js';
import { noteTranslation, visualLabelKey } from './machine/notes.js';
import { MachineTranslationFailed, type MachineTranslator } from './machine/providers.js';
import { MARKERS } from './profiles.js';

/**
 * Revisão automática (ADR-016): em vez de só apontar, corrige o que tem conserto determinístico e devolve a lista do
 * que mudou. Trecho no idioma errado ou sem tradução volta a ser traduzido do original; número, data e código alterados
 * voltam ao formato da regra; glossário, marcadores de elementos visuais e espaçamento são acertados. O que não tem
 * conserto seguro fica em `unresolved` para a pessoa.
 */
export type CorrectionCode =
  | 'wrong_language'
  | 'untranslated'
  | 'number_restored'
  | 'date_format'
  | 'glossary'
  | 'marker_language'
  | 'translator_note'
  | 'spacing'
  | 'content_lost'
  | 'layout'
  | 'document_type';

export interface Correction {
  code: CorrectionCode;
  /** Bloco (1 = primeiro) onde a correção foi feita; 0 para dados do documento. */
  block: number;
  before: string;
  after: string;
  message: string;
}

export interface AutoReviewInput {
  draft: Draft;
  sourceText: string | null;
  glossary: GlossaryTerm[];
  rules?: (SegmentRules & { visualElements?: 'markers' | 'translator_notes'; otherLanguages?: 'transcribe' | 'translate' }) | null;
  /** Sem provedor, a revisão ainda corrige números, datas, glossário e marcadores; só não retraduz. */
  translator: MachineTranslator | null;
}

export interface AutoReviewResult {
  draft: Draft;
  corrections: Correction[];
  unresolved: string[];
}

/** Um trecho editável do rascunho (parágrafo, célula, cargo da assinatura) com o original correspondente. */
interface Unit {
  block: number;
  /** Trecho vindo da memória de tradução: já aprovado por uma pessoa, não é retraduzido. */
  approved: boolean;
  source: string | null;
  get: () => string;
  set: (value: string) => void;
}

const LANGUAGE_LABEL: Record<Language, string> = { pt: 'português', en: 'inglês', fr: 'francês', it: 'italiano', es: 'espanhol' };
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const hasLetters = (text: string) => /\p{L}{2}/u.test(text);
const digits = (text: string) => text.replace(/\D/g, '');
const termPattern = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu');
/** Número inteiro no texto, sem pegar pedaço de outro número. */
const numberPattern = (value: string) => new RegExp(`(?<![\\p{N}])${escapeRegExp(value)}(?![\\p{N}]|[.,]\\p{N})`, 'u');

function unitsOf(draft: Draft): Unit[] {
  const units: Unit[] = [];
  draft.blocks.forEach((block, index) => {
    const at = index + 1;
    const approved = block.origin === 'memory';
    if (block.kind === 'table') {
      for (const row of block.rows)
        for (const cell of row.cells)
          units.push({ block: at, approved, source: cell.sourceText ?? null, get: () => cell.text, set: (value) => (cell.text = value) });
    } else if (block.kind === 'signature') {
      const role = block.sourceText?.startsWith(`${block.name} – `) ? block.sourceText.slice(block.name.length + 3) : null;
      units.push({ block: at, approved, source: role, get: () => block.role, set: (value) => (block.role = value) });
    } else if (block.kind !== 'translator_note') {
      units.push({ block: at, approved, source: block.sourceText, get: () => block.text, set: (value) => (block.text = value) });
    }
  });
  return units;
}

/** Rótulo de marcador ("Carimbo", "Stamp") → chave, em qualquer idioma. */
const MARKER_KEYS = (() => {
  const keys = new Map<string, keyof (typeof MARKERS)['en']>();
  for (const labels of Object.values(MARKERS))
    for (const [key, label] of Object.entries(labels) as Array<[keyof (typeof MARKERS)['en'], string]>) keys.set(label.toLowerCase(), key);
  return keys;
})();

/** Nota do tradutor → marcador entre colchetes no idioma de destino (regra das skills). */
function noteAsMarker(text: string, quote: string | null, target: Language) {
  const m = MARKERS[target];
  const lower = text.toLowerCase();
  const translated = quote ? (noteTranslation(text, quote) ?? quote) : null;
  if (/emblem|brasão|armoiries|stemma|escudo|coat of arms/.test(lower)) return `[${m.coatOfArms}]`;
  if (/watermark|marca d.água|filigran|marca de agua/.test(lower)) return `[${m.watermark}${translated ? `: ${translated}` : ''}]`;
  if (/^(footer|rodapé|pied de page|piè di pagina|pie de página)\s*:/.test(lower)) return translated ?? text.replace(/^[^:]+:\s*/, '');
  if (/stamp|carimbo|cachet|timbro|sello/.test(lower)) return `[${m.stamp}${translated ? `: ${translated}` : ''}]`;
  if (/signature|assinatura|firma/.test(lower))
    return `[${/illeg|ilegív|illisible|ilegible/.test(lower) ? m.illegibleSignature : m.signature}]`;
  if (/qr/.test(lower)) return `[${m.qrCode}]`;
  return `[${text.replace(/^[[\s]+|[\].\s]+$/g, '')}]`;
}

export async function autoReview(input: AutoReviewInput): Promise<AutoReviewResult> {
  const draft = structuredClone(input.draft);
  const { sourceLanguage: from, targetLanguage: to } = draft;
  const rules = input.rules ?? {};
  const segmentRules: SegmentRules = {
    ...(rules.dates ? { dates: rules.dates } : {}),
    ...(rules.numbers ? { numbers: rules.numbers } : {}),
  };
  const corrections: Correction[] = [];
  const unresolved: string[] = [];
  const record = (code: CorrectionCode, block: number, before: string, after: string, message: string) =>
    corrections.push({ code, block, before, after, message });

  // 1. Notas do tradutor onde a regra pede só marcador.
  if (rules.visualElements === 'markers') {
    draft.blocks = draft.blocks.map((block, index): DraftBlock => {
      if (block.kind !== 'translator_note') return block;
      const text = noteAsMarker(block.text, block.sourceText, to);
      record('translator_note', index + 1, block.text, text, 'Nota do tradutor trocada pelo marcador entre colchetes');
      return { kind: 'paragraph', text, align: 'left', bold: false, size: 'normal', sourceText: block.sourceText, origin: block.origin };
    });
  }

  const units = unitsOf(draft);
  const retranslate = new Map<Unit, CorrectionCode>();

  for (const unit of units) {
    let text = unit.get();
    // 2. Espaços repetidos e espaço antes de pontuação (o francês usa espaço antes de ; : ! ?).
    let spaced = text.replace(/[ \t]{2,}/g, ' ');
    // Francês e italiano: o provedor separa a elisão ("l ' État", "dell ' anno").
    if (to === 'fr' || to === 'it') spaced = spaced.replace(/(\p{L})\s*['’]\s+(?=\p{L})/gu, "$1'");
    spaced = spaced.replace(to === 'fr' ? /\s+([,.](?!\d))/g : /\s+([,.;:!?](?!\d))/g, '$1').trim();
    if (spaced !== text && spaced) {
      record('spacing', unit.block, text, spaced, 'Espaçamento corrigido');
      unit.set((text = spaced));
    }

    // 3. Marcadores de elementos visuais no idioma errado ("[Carimbo]" num documento em inglês).
    const marked = text.replace(/\[([^\]:[]+)(:[^\]]*)?\]/g, (match, label: string, rest: string | undefined) => {
      const key = MARKER_KEYS.get(label.trim().toLowerCase()) ?? visualLabelKey(label);
      if (!key || MARKERS[to][key].toLowerCase() === label.trim().toLowerCase()) return match;
      return `[${MARKERS[to][key]}${rest ?? ''}]`;
    });
    if (marked !== text) {
      record('marker_language', unit.block, text, marked, `Marcador no idioma de destino (${LANGUAGE_LABEL[to]})`);
      unit.set((text = marked));
    }

    if (!unit.source || unit.approved || !hasLetters(unit.source) || isCodeLike(unit.source)) continue;
    // Trecho em um terceiro idioma no original: as skills mandam transcrever sem traduzir.
    const sourceLanguage = confidentLanguage(unit.source, 3);
    const thirdLanguage = sourceLanguage !== null && sourceLanguage !== from && sourceLanguage !== to;
    if (thirdLanguage && rules.otherLanguages !== 'translate') continue;

    // Conteúdo perdido: o original tem palavras e a tradução ficou sem nenhuma ("1ª habilitação" → "1").
    if (/\p{L}{3}/u.test(unit.source) && !/\p{L}{2}/u.test(text)) {
      retranslate.set(unit, 'content_lost');
      continue;
    }

    // 4. Idioma errado: o trecho não está no idioma de destino.
    const detected = confidentLanguage(text);
    if (detected && detected !== to) {
      retranslate.set(unit, normalize(text) === normalize(unit.source) ? 'untranslated' : 'wrong_language');
      continue;
    }
    if (normalize(text) === normalize(unit.source) && sourceLanguage === from) {
      retranslate.set(unit, 'untranslated');
      continue;
    }

    // 5. Glossário: termo do original sem a tradução aprovada.
    for (const term of input.glossary) {
      if (!termPattern(term.source).test(unit.source) || termPattern(term.target).test(text)) continue;
      const pattern = termPattern(term.source);
      if (pattern.test(text)) {
        const fixed = text.replace(new RegExp(pattern.source, 'giu'), term.target);
        record('glossary', unit.block, text, fixed, `Glossário: "${term.source}" → "${term.target}"`);
        unit.set((text = fixed));
      } else if (input.translator) {
        retranslate.set(unit, 'glossary');
        break;
      }
    }
  }

  // 6. Retradução, num lote só, a partir do original (com glossário e números protegidos).
  if (retranslate.size) {
    const keep = properNounsOf(units.map((unit) => unit.source ?? '').filter(Boolean));
    const pending = [...retranslate.keys()].map((unit) => ({
      unit,
      guarded: guardForTranslation(prepareSegment(unit.source!, from, to, segmentRules), to, input.glossary, keep),
    }));
    let translated: string[] | null = null;
    if (input.translator) {
      try {
        translated = await input.translator.translate(
          pending.map((item) => item.guarded.text),
          from,
          to,
        );
      } catch (error) {
        if (!(error instanceof MachineTranslationFailed)) throw error;
        unresolved.push(`A tradução automática falhou (${error.message}); ${pending.length} trecho(s) continuam para revisão manual.`);
      }
    }
    pending.forEach(({ unit, guarded }, index) => {
      const code = retranslate.get(unit)!;
      const restored = translated ? guarded.restore(translated[index] ?? '') : null;
      const before = unit.get();
      if (restored && restored.trim() && normalize(restored) !== normalize(before)) {
        unit.set(restored);
        record(
          code,
          unit.block,
          before,
          restored,
          code === 'glossary'
            ? 'Retraduzido do original para aplicar o glossário'
            : code === 'untranslated'
              ? 'Trecho sem tradução: traduzido do original'
              : code === 'content_lost'
                ? 'Texto perdido na tradução: traduzido de novo a partir do original'
                : `Trecho fora do ${LANGUAGE_LABEL[to]}: traduzido de novo a partir do original`,
        );
      } else if (!translated && !unresolved.some((line) => line.startsWith('A tradução automática'))) {
        unresolved.push(
          `Bloco ${unit.block}: trecho fora do ${LANGUAGE_LABEL[to]} ("${before.slice(0, 60)}"); sem tradutor automático para refazer.`,
        );
      }
    });
  }

  // 7. Números, datas e códigos: voltam ao formato da regra; nunca ficam faltando.
  for (const unit of units) {
    if (!unit.source) continue;
    for (const token of numericTokens(unit.source)) {
      let text = unit.get();
      const expected = prepareSegment(token, from, to, segmentRules);
      if (text.includes(expected)) continue;
      const variants = [
        token,
        swapNumberSeparators(token),
        convertNumericDate(token, from, to),
        numericDateToLong(token, from, to),
        // Dia e mês trocados (formato americano) mesmo entre idiomas que escrevem a data igual.
        token.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, '$2/$1/$3'),
      ].filter((variant, index, all) => variant !== expected && all.indexOf(variant) === index);
      const found = variants.find((variant) => numberPattern(variant).test(text));
      let replacement: string | null = null;
      if (found) replacement = found;
      else if (/\p{L}/u.test(expected)) {
        // Data por extenso com a pontuação mexida pelo provedor ("September 5 2025" no lugar de "September 5, 2025").
        const loose = new RegExp(
          expected
            .split(/[\s,]+/)
            .map(escapeRegExp)
            .join('[\\s,.]*'),
          'iu',
        );
        replacement = loose.exec(text)?.[0] ?? null;
      }
      if (replacement === null) {
        // Mesmo número com separadores trocados ou perdidos pelo provedor ("12,345,678-9", "12 345 678-9").
        const want = digits(token);
        const candidate = (text.match(/\p{N}(?:[\p{N}.,/ -]*\p{N})?/gu) ?? []).find((value) => digits(value) === want);
        if (candidate) replacement = candidate;
      }
      if (replacement === expected) continue;
      if (replacement !== null) {
        const fixed = text.replace(replacement, expected);
        const isDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(token);
        record(
          isDate ? 'date_format' : 'number_restored',
          unit.block,
          text,
          fixed,
          isDate ? `Data no formato da regra: ${expected}` : `Número como no original: ${expected}`,
        );
        unit.set((text = fixed));
      } else if (!text.includes(token)) {
        unresolved.push(`Bloco ${unit.block}: número do original ${token} não encontrado; confira o trecho.`);
      }
    }
  }

  // 8. Tipo de documento em branco: o título do original traduzido.
  if (!draft.documentType.trim() && draft.sourceTitle.trim() && input.translator) {
    try {
      const [title] = await input.translator.translate([draft.sourceTitle], from, to);
      if (title?.trim()) {
        draft.documentType = title.trim().toUpperCase();
        record('document_type', 0, '', draft.documentType, 'Tipo de documento preenchido com o título traduzido');
      }
    } catch (error) {
      if (!(error instanceof MachineTranslationFailed)) throw error;
    }
  }

  return { draft, corrections, unresolved };
}

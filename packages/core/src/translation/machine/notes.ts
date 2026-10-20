import type { Language } from '../draft.js';
import type { LayoutNote } from '../layout/source-layout.js';
import { MARKERS } from '../profiles.js';

const POSITION: Record<Language, Record<'left' | 'center' | 'right', string>> = {
  en: { left: 'at the top left', center: 'at the top center', right: 'at the top right' },
  pt: { left: 'no alto, à esquerda', center: 'no alto, ao centro', right: 'no alto, à direita' },
  fr: { left: 'en haut à gauche', center: 'en haut au centre', right: 'en haut à droite' },
  it: { left: 'in alto a sinistra', center: 'in alto al centro', right: 'in alto a destra' },
  es: { left: 'arriba a la izquierda', center: 'arriba al centro', right: 'arriba a la derecha' },
};

const TEMPLATES: Record<Language, { emblem: (where: string) => string; stamp: string; watermark: string; footer: string }> = {
  en: {
    emblem: (where) => `The document bears, ${where}, an emblem.`,
    stamp: 'Stamp reading',
    watermark: 'The document bears a diagonal watermark reading',
    footer: 'Footer',
  },
  pt: {
    emblem: (where) => `O documento apresenta, ${where}, um brasão.`,
    stamp: 'Carimbo com os dizeres',
    watermark: 'O documento apresenta marca d’água diagonal com os dizeres',
    footer: 'Rodapé',
  },
  fr: {
    emblem: (where) => `Le document porte, ${where}, des armoiries.`,
    stamp: 'Cachet portant la mention',
    watermark: 'Le document porte un filigrane diagonal portant la mention',
    footer: 'Pied de page',
  },
  it: {
    emblem: (where) => `Il documento reca, ${where}, uno stemma.`,
    stamp: 'Timbro con la dicitura',
    watermark: 'Il documento reca una filigrana diagonale con la dicitura',
    footer: 'Piè di pagina',
  },
  es: {
    emblem: (where) => `El documento presenta, ${where}, un escudo.`,
    stamp: 'Sello con la leyenda',
    watermark: 'El documento presenta una marca de agua diagonal con la leyenda',
    footer: 'Pie de página',
  },
};

/**
 * Texto da nota do tradutor para um elemento não textual, no idioma de destino (ADR-009), no padrão do modelo:
 * a citação fica no original, com a tradução entre colchetes. O "[Translator's note: …]" vem do modelo juramentado.
 */
export function noteText(note: LayoutNote, target: Language, translated: string) {
  const bracket = translated && 'quote' in note && translated !== note.quote ? ` [${translated}]` : '';
  const t = TEMPLATES[target];
  switch (note.kind) {
    case 'emblem':
      return t.emblem(POSITION[target][note.position]);
    case 'stamp':
      return `${t.stamp}: “${note.quote}”${bracket}.`;
    case 'watermark':
      return `${t.watermark} “${note.quote}”${bracket}.`;
    case 'footer':
      return `${t.footer}: “${translated || note.quote}”`;
  }
}

/**
 * Elemento visual só como marcador entre colchetes, como pedem as skills de tradução (ADR-015): nada de nota
 * descritiva. Carimbo e marca d'água levam o texto traduzido; o rodapé é conteúdo e sai traduzido, sem colchetes.
 */
export function markerText(note: LayoutNote, target: Language, translated: string) {
  const m = MARKERS[target];
  switch (note.kind) {
    case 'emblem':
      return `[${m.coatOfArms}]`;
    case 'stamp':
      return `[${m.stamp}: ${translated || note.quote}]`;
    case 'watermark':
      return `[${m.watermark}: ${translated || note.quote}]`;
    case 'footer':
      return translated || note.quote;
  }
}

/**
 * Tradução da citação contida numa nota já revisada, para a memória: o que está entre colchetes logo após a
 * citação, ou o texto entre aspas do rodapé. Sem colchetes, a citação ficou igual ao original.
 */
export function noteTranslation(text: string, quote: string): string | null {
  const quoted = `“${quote}”`;
  const at = text.indexOf(quoted);
  if (at >= 0) {
    const bracket = /^\s*\[([^\]]+)\]/.exec(text.slice(at + quoted.length));
    return bracket ? bracket[1]!.trim() : quote;
  }
  const footer = /^(?:Footer|Rodapé|Pied de page|Piè di pagina|Pie de página):\s*“(.+)”\s*$/.exec(text.trim());
  return footer ? footer[1]!.trim() : null;
}

/** Rótulos do original que indicam um elemento visual, no idioma de origem (sem acento, em maiúsculas). */
const VISUAL_LABELS: Record<string, keyof (typeof MARKERS)['en']> = {
  BRASAO: 'coatOfArms',
  'BRASAO DA REPUBLICA': 'coatOfArms',
  'BRASAO DE ARMAS': 'coatOfArms',
  'COAT OF ARMS': 'coatOfArms',
  SIMBOLO: 'logo',
  LOGOTIPO: 'logo',
  LOGO: 'logo',
  SELO: 'seal',
  SEAL: 'seal',
  CARIMBO: 'stamp',
  STAMP: 'stamp',
  'QR CODE': 'qrCode',
  'CODIGO QR': 'qrCode',
  ASSINATURA: 'signature',
  SIGNATURE: 'signature',
  'ASSINATURA ELETRONICA': 'electronicSignature',
  'ASSINATURA DIGITAL': 'electronicSignature',
  FOTO: 'photo',
  FOTOGRAFIA: 'photo',
  PHOTO: 'photo',
};

const foldLabel = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[[\]]/g, '')
    .trim()
    .toUpperCase();

/** Chave do marcador para um rótulo de elemento visual ("Brasão", "[QR CODE]"), em qualquer idioma conhecido. */
export function visualLabelKey(text: string): keyof (typeof MARKERS)['en'] | null {
  const folded = foldLabel(text);
  if (VISUAL_LABELS[folded]) return VISUAL_LABELS[folded];
  for (const labels of Object.values(MARKERS))
    for (const [key, label] of Object.entries(labels)) if (foldLabel(label) === folded) return key as keyof (typeof MARKERS)['en'];
  return null;
}

/** Parágrafo que é só o rótulo de um elemento visual vira o marcador no idioma de destino ("[Coat of Arms]"). */
export function visualLabel(text: string, target: Language) {
  const plain = text.replace(/\*\*/g, '').trim();
  if (plain.length > 40) return null;
  const key = visualLabelKey(plain);
  return key ? `[${MARKERS[target][key]}]` : null;
}

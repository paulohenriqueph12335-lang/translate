import type { DraftBlock } from '../draft.js';

/**
 * Estrutura do documento original (ADR-009): os mesmos blocos do rascunho, com o texto ainda no idioma de origem,
 * mais os elementos não textuais que viram notas do tradutor. A tradução preenche esta estrutura sem mudá-la.
 */
export interface SourceLayout {
  blocks: DraftBlock[];
  notes: LayoutNote[];
  /** Título do documento pelo layout (maior texto em negrito), quando houver. */
  title: string | null;
}

export type NotePosition = 'left' | 'center' | 'right';

/** Elemento visual descrito por nota do tradutor; `at` define se a nota abre ou fecha o corpo. */
export type LayoutNote =
  | { kind: 'emblem'; at: 'start'; position: NotePosition }
  | { kind: 'watermark'; at: 'end'; quote: string }
  | { kind: 'stamp'; at: 'end'; quote: string }
  | { kind: 'footer'; at: 'end'; quote: string };

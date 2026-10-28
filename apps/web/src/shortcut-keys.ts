/** Teclas dos atalhos (2026-10-28), sem React, para os testes. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Teclas como aparecem na tela: Ctrl vira ⌘ no Mac. */
export const keyParts = (keys: string) =>
  keys.includes('+') ? keys.split('+').map((part) => (part === 'Ctrl' && isMac ? '⌘' : part)) : keys.split(' ');

/** Atributos de uma ação com atalho: a dica ao passar o mouse e o anúncio para leitores de tela. */
export const shortcutProps = (keys: string) => ({
  'data-shortcut': keys,
  ...(keys.includes(' ') ? {} : { 'aria-keyshortcuts': keys.replace('Ctrl', isMac ? 'Meta' : 'Control') }),
});

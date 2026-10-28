import { useEffect, useRef, useState } from 'react';
import { keyParts } from './shortcut-keys';

export { keyParts, shortcutProps } from './shortcut-keys';

/**
 * Atalhos de teclado (2026-10-28). No máximo duas teclas: uma tecla só (`N`), uma combinação (`Ctrl+K`) ou uma
 * sequência curta (`G I`: G e depois I). Ao passar o mouse ou focar uma ação com atalho, a dica mostra as teclas.
 */
export interface Shortcut {
  /** "N", "?", "Ctrl+K" ou "G I". */
  keys: string;
  label: string;
  group: 'Ir para' | 'Ações' | 'Nesta tela';
  /** Sem `run`, o atalho só aparece na lista: quem cuida dele é a própria tela. */
  run?: () => void;
}

const SEQUENCE_MS = 1500;
/** Digitando num campo, os atalhos de uma tecla não valem. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('[role="dialog"]'));

const comboOf = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) && event.key.length === 1 ? `Ctrl+${event.key.toUpperCase()}` : null;

export function useShortcuts(list: Shortcut[]) {
  const current = useRef(list);
  current.current = list.filter((item) => item.run);
  useEffect(() => {
    let pending: { key: string; at: number } | null = null;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const combo = comboOf(event);
      if (combo) {
        const match = current.current.find((item) => item.keys === combo);
        if (match) {
          event.preventDefault();
          match.run!();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || typing(event.target)) return;
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (pending && Date.now() - pending.at < SEQUENCE_MS) {
        const match = current.current.find((item) => item.keys === `${pending!.key} ${key}`);
        pending = null;
        if (match) {
          event.preventDefault();
          match.run!();
          return;
        }
      }
      if (current.current.some((item) => item.keys.startsWith(`${key} `))) {
        pending = { key, at: Date.now() };
        return;
      }
      const match = current.current.find((item) => item.keys === key);
      if (match) {
        event.preventDefault();
        match.run!();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

export function Keys({ keys }: { keys: string }) {
  const parts = keyParts(keys);
  const joiner = keys.includes('+') ? '+' : 'e depois';
  return (
    <span className="keys">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="keys-joiner">{joiner}</span>}
          <kbd>{part}</kbd>
        </span>
      ))}
    </span>
  );
}

/** Dica de atalho: aparece ao passar o mouse (ou focar pelo teclado) numa ação marcada com `data-shortcut`. */
export function ShortcutTip() {
  const [tip, setTip] = useState<{ keys: string; label: string; top: number; left: number; side: 'below' | 'right' } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-shortcut]');
      clearTimeout(timer);
      if (!element) return setTip(null);
      timer = setTimeout(
        () => {
          const box = element.getBoundingClientRect();
          const label = element.dataset.shortcutLabel ?? element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
          const keys = element.dataset.shortcut!;
          const text = label.replace(/,\s*\d+$/, '');
          // No menu lateral, a dica fica ao lado, sem cobrir o item de baixo.
          if (element.closest('.sidebar')) {
            setTip({ keys, label: text, side: 'right', top: box.top + box.height / 2, left: box.right + 8 });
            return;
          }
          const below = box.bottom + 44 < window.innerHeight;
          setTip({
            keys,
            label: text,
            side: 'below',
            top: below ? box.bottom + 6 : box.top - 40,
            left: Math.min(Math.max(8, box.left + box.width / 2), window.innerWidth - 8),
          });
        },
        event.type === 'focusin' ? 0 : 350,
      );
    };
    const hide = () => {
      clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={`shortcut-tip ${tip.side}`} role="tooltip" style={{ top: tip.top, left: tip.left }}>
      {tip.label && <span className="shortcut-tip-label">{tip.label}</span>}
      <Keys keys={tip.keys} />
    </div>
  );
}

/** Lista de atalhos (tecla ?). */
export function ShortcutsDialog({ open, onClose, list }: { open: boolean; onClose: () => void; list: Shortcut[] }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const groups = (['Ir para', 'Ações', 'Nesta tela'] as const)
    .map((group) => ({ group, items: list.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length);
  return (
    <>
      <div className="cmdk-backdrop" onClick={onClose} />
      <div className="cmdk shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="shortcuts-head">
          <h2 id="shortcuts-title">Atalhos de teclado</h2>
          <button ref={closeButton} type="button" className="ghost small" onClick={onClose}>
            Fechar
          </button>
        </header>
        <p className="muted small-text shortcuts-note">
          Sequências como <Keys keys="G I" /> são duas teclas, uma depois da outra. Os atalhos não valem enquanto você digita num campo.
        </p>
        <div className="shortcuts-body">
          {groups.map(({ group, items }) => (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {items.map((item) => (
                  <div key={item.keys}>
                    <dt>{item.label}</dt>
                    <dd>
                      <Keys keys={item.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

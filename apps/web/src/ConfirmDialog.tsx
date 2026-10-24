import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
}
type Confirmation = ConfirmOptions & { owner: symbol; resolve: (confirmed: boolean) => void };
interface ConfirmContextValue {
  request: (owner: symbol, options: ConfirmOptions) => Promise<boolean>;
  cancel: (owner: symbol) => void;
}
const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/** A single application dialog keeps focus and resolves cancelled/unmounted operations without sending a mutation. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef<Confirmation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const finish = useCallback((confirmed: boolean) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    dialog.current?.close();
    setConfirmation(null);
    current.resolve(confirmed);
  }, []);
  const request = useCallback((owner: symbol, options: ConfirmOptions) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const current = { ...options, owner, resolve };
      pending.current = current;
      setConfirmation(current);
    });
  }, []);
  const cancel = useCallback(
    (owner: symbol) => {
      if (pending.current?.owner === owner) finish(false);
    },
    [finish],
  );
  const context = useMemo(() => ({ request, cancel }), [request, cancel]);
  useEffect(() => {
    if (!confirmation || !dialog.current) return;
    if (!dialog.current.open) dialog.current.showModal();
    cancelButton.current?.focus();
  }, [confirmation]);
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    [],
  );
  return (
    <ConfirmContext.Provider value={context}>
      {children}
      <dialog
        ref={dialog}
        className="dashboard-dialog no-print"
        style={{ width: 'min(520px, calc(100vw - 32px))' }}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        onClose={() => {
          if (!dialog.current?.open) finish(false);
        }}
      >
        <h2 id={titleId}>{confirmation?.title ?? 'Confirmar alteração'}</h2>
        <p id={messageId} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
          {confirmation?.message}
        </p>
        <div className="actions">
          <button ref={cancelButton} type="button" autoFocus onClick={() => finish(false)}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={() => finish(true)}>
            {confirmation?.confirmLabel ?? 'Confirmar alteração'}
          </button>
        </div>
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm exige ConfirmProvider.');
  const owner = useRef(Symbol('confirmation-owner'));
  useEffect(() => () => context.cancel(owner.current), [context]);
  return useCallback(
    (options: ConfirmOptions | string) => context.request(owner.current, typeof options === 'string' ? { message: options } : options),
    [context],
  );
}

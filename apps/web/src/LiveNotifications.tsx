import { useCallback, useEffect, useRef, useState } from 'react';
import { api, notificationKindLabel, type NotificationItem, type Page } from './api';
import {
  advanceNotificationPolicy,
  createNotificationPolicy,
  loadNotificationSeen,
  saveNotificationSeen,
  type NotificationPreferences,
} from './notification-policy';

const POLL_MS = 20_000;
const TOAST_MS = 7_000;

export type PopupPermission = NotificationPermission | 'unsupported';

function popupPermission(): PopupPermission {
  try {
    return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext ? Notification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function usePopupPermission() {
  const [permission, setPermission] = useState<PopupPermission>(popupPermission);
  const [error, setError] = useState('');
  const requesting = useRef(false);
  const request = useCallback(async () => {
    if (popupPermission() === 'unsupported' || requesting.current) return;
    requesting.current = true;
    setError('');
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(popupPermission());
      setError('Não foi possível solicitar a permissão. Tente novamente ou confira as configurações do navegador.');
    } finally {
      requesting.current = false;
    }
  }, []);
  return { permission, request, error };
}

/** Alerts follow the user's preferences; the notification center keeps its own unread state. */
export function LiveNotifications({
  userId,
  preferences,
  onOpenTranslation,
  onOpenNotifications,
  onNew,
}: {
  userId: string;
  preferences: NotificationPreferences | null;
  onOpenTranslation: (id: string) => void;
  onOpenNotifications: () => void;
  onNew: () => void;
}) {
  const enabled = preferences?.notificationsEnabled === true;
  const frequency = preferences?.notificationFrequency ?? 'immediate';
  const scope = JSON.stringify([userId, enabled, frequency]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [toasts, setToasts] = useState<{ scope: string; items: NotificationItem[] }>({ scope, items: [] });
  // A previous effect may still have a request in progress after a settings change.
  const inFlight = useRef(false);
  const open = useRef({ onOpenTranslation, onOpenNotifications, onNew });
  open.current = { onOpenTranslation, onOpenNotifications, onNew };

  const dismiss = useCallback(
    (id: string) => setToasts((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) })),
    [],
  );

  const follow = useCallback(
    (item: NotificationItem) => {
      dismiss(item.id);
      if (item.translationId) open.current.onOpenTranslation(item.translationId);
      else open.current.onOpenNotifications();
    },
    [dismiss],
  );

  useEffect(() => {
    setToasts({ scope, items: [] });
    if (!enabled) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let policy = createNotificationPolicy<NotificationItem>(loadNotificationSeen(browserStorage(), userId));
    const popups = new Set<Notification>();
    const active = () => alive && currentScope.current === scope;

    const check = async () => {
      if (!active()) return;
      if (inFlight.current) {
        timer = setTimeout(() => void check(), POLL_MS);
        return;
      }

      inFlight.current = true;
      try {
        // Read every page so a burst of notifications is not lost between delayed deliveries.
        const unread: NotificationItem[] = [];
        let cursor: string | null = null;
        do {
          const query = new URLSearchParams({ unread: 'true', limit: '100' });
          if (cursor) query.set('cursor', cursor);
          const page: Page<NotificationItem> = await api('GET', `/notifications?${query.toString()}`);
          if (!active()) return;
          unread.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);

        const result = advanceNotificationPolicy(policy, unread, frequency, Date.now());
        policy = result.state;
        saveNotificationSeen(browserStorage(), userId, policy.seen);
        if (result.fresh.length) open.current.onNew();
        if (!result.alerts.length) return;

        setToasts((current) => ({
          scope,
          items: [...(current.scope === scope ? current.items : []), ...result.alerts].slice(-4),
        }));
        if (popupPermission() !== 'granted') return;
        for (const item of result.alerts) {
          try {
            const popup = new Notification(item.title, {
              body: [notificationKindLabel[item.kind] ?? null, item.body].filter(Boolean).join(' · '),
              tag: `tradutor-${userId}-${item.id}`,
            });
            popups.add(popup);
            popup.onclose = () => popups.delete(popup);
            popup.onclick = () => {
              if (!active()) return;
              window.focus();
              follow(item);
              popup.close();
            };
          } catch {
            // Some browsers reject native pop-ups despite granting permission. Keep in-app alerts working.
          }
        }
      } catch {
        // Temporary network failures retain the baseline and pending batch for the next successful poll.
      } finally {
        inFlight.current = false;
        if (active()) timer = setTimeout(() => void check(), POLL_MS);
      }
    };

    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
      for (const popup of popups) {
        popup.onclick = null;
        popup.onclose = null;
        try {
          popup.close();
        } catch {
          // Closing a native popup is best effort when the browser has already discarded it.
        }
      }
      popups.clear();
    };
  }, [enabled, frequency, scope, userId, follow]);

  useEffect(() => {
    if (!enabled || toasts.scope !== scope || !toasts.items.length) return;
    const timer = setTimeout(() => setToasts((current) => ({ ...current, items: current.items.slice(1) })), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts, enabled, scope]);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {enabled &&
        toasts.scope === scope &&
        toasts.items.map((item) => (
          <div key={item.id} className="toast" style={{ ['--toast-ms' as string]: `${TOAST_MS}ms` }}>
            <button type="button" className="toast-body" onClick={() => follow(item)}>
              <span className="badge soft">{notificationKindLabel[item.kind] ?? 'Notificação'}</span>
              <strong>{item.title}</strong>
              {item.body && <span className="small-text">{item.body}</span>}
            </button>
            <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(item.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
    </div>
  );
}

/** Browser permission is separate from the user's preference to receive alerts. */
export function PopupSettings({ enabled = true }: { enabled?: boolean }) {
  const { permission, request, error } = usePopupPermission();
  if (!enabled) {
    return (
      <p className="popup-settings muted small-text">
        Os avisos estão desativados nas suas configurações. Ative-os para receber avisos na tela e permitir pop-ups do sistema.
      </p>
    );
  }
  if (permission === 'granted') {
    return <p className="popup-settings muted small-text">Pop-ups do sistema ativados neste navegador.</p>;
  }
  if (permission === 'unsupported') {
    return (
      <p className="popup-settings muted small-text">
        Este navegador não mostra pop-ups do sistema neste endereço. Abra o sistema por http://localhost:5173 no Chrome ou no Edge.
      </p>
    );
  }
  if (permission === 'denied') {
    return (
      <p className="popup-settings muted small-text">
        Os pop-ups estão bloqueados no navegador. Para liberar, clique no cadeado ao lado do endereço, em Notificações escolha Permitir e
        recarregue a página.
      </p>
    );
  }
  return (
    <div className="popup-settings">
      <span className="small-text">Receba os avisos como pop-up do sistema, mesmo com outra janela na frente.</span>
      <button type="button" className="small" onClick={() => enabled && void request()}>
        Ativar pop-ups do sistema
      </button>
      {error && <p className="small-text error-text">{error}</p>}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, notificationKindLabel, type NotificationItem } from './api';
import { useNotificationSettings } from './notification-preferences';

const POLL_MS = 20_000;
const TOAST_MS = 6_000;
export type PopupPermission = NotificationPermission | 'unsupported';
function popupPermission(): PopupPermission {
  try {
    return 'Notification' in window && window.isSecureContext ? Notification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}
export function usePopupPermission() {
  const [permission, setPermission] = useState<PopupPermission>(popupPermission);
  const [error, setError] = useState('');
  const requesting = useRef(false);
  useEffect(() => {
    const refresh = () => setPermission(popupPermission());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const request = useCallback(async () => {
    if (popupPermission() === 'unsupported' || requesting.current) return;
    requesting.current = true;
    setError('');
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(popupPermission());
      setError('Confira a permissão de notificações deste navegador e tente novamente.');
    } finally {
      requesting.current = false;
    }
  }, []);
  return { permission, request, error };
}
interface AlertItem {
  id: string;
  title: string;
  body: string | null;
  reason?: string;
  translationId: string | null;
  kind: string;
}
interface Delivery {
  items: Array<NotificationItem & { reason?: string }>;
  summary: { title: string; body: string; count: number; severity: string } | null;
  deliveryMode: 'digest' | 'individual';
}

/** The server claims deliveries once per account/channel, across tabs and devices. */
export function LiveNotifications({
  userId,
  onOpenTranslation,
  onOpenNotifications,
  onNew,
}: {
  userId: string;
  onOpenTranslation: (id: string) => void;
  onOpenNotifications: () => void;
  onNew: () => void;
}) {
  const settings = useNotificationSettings();
  const enabled = settings.data?.notificationsEnabled === true;
  const scope = JSON.stringify([userId, settings.data]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [queue, setQueue] = useState<{ scope: string; items: AlertItem[] }>({ scope, items: [] });
  const open = useRef({ onOpenTranslation, onOpenNotifications, onNew });
  open.current = { onOpenTranslation, onOpenNotifications, onNew };
  const dismiss = useCallback((id: string) => setQueue((value) => ({ ...value, items: value.items.filter((item) => item.id !== id) })), []);
  const follow = useCallback(
    (item: AlertItem) => {
      dismiss(item.id);
      if (item.translationId) open.current.onOpenTranslation(item.translationId);
      else open.current.onOpenNotifications();
    },
    [dismiss],
  );
  useEffect(() => {
    setQueue({ scope, items: [] });
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const popups = new Set<Notification>();
    const active = () => alive && currentScope.current === scope;
    const alerts = (delivery: Delivery): AlertItem[] =>
      delivery.deliveryMode === 'digest' && delivery.summary
        ? [
            {
              id: `summary-${delivery.items.map((item) => item.id).join('-')}`,
              title: delivery.summary.title,
              body: delivery.summary.body,
              translationId: null,
              kind: 'summary',
              reason: 'Resumo dos assuntos e canais que você escolheu para seu trabalho.',
            },
          ]
        : delivery.items;
    const check = async () => {
      try {
        for (const channel of ['inApp', 'browser'] as const) {
          if (!active()) return;
          if (channel === 'browser' && popupPermission() !== 'granted') continue;
          const delivery = await api<Delivery>('POST', '/notifications/deliveries/claim', { channel });
          if (!active()) return;
          if (!delivery.items.length) continue;
          open.current.onNew();
          const items = alerts(delivery);
          if (channel === 'inApp')
            setQueue((value) => ({ scope, items: [...(value.scope === scope ? value.items : []), ...items].slice(-100) }));
          else
            for (const item of items) {
              try {
                const popup = new Notification(item.title, {
                  body: [item.body, item.reason].filter(Boolean).join('\n'),
                  tag: `tradutor-${userId}-${item.id}`,
                });
                popups.add(popup);
                popup.onclose = () => popups.delete(popup);
                popup.onclick = () => {
                  if (active()) {
                    window.focus();
                    follow(item);
                  }
                  popup.close();
                };
              } catch {
                /* The notification center retains events if OS settings prevent a native popup. */
              }
            }
        }
      } catch {
        /* The durable cursor remains available on the next successful poll. */
      } finally {
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
        popup.close();
      }
      popups.clear();
    };
  }, [scope, enabled, userId, follow]);
  useEffect(() => {
    if (!enabled || queue.scope !== scope || !queue.items.length) return;
    const timer = setTimeout(() => setQueue((value) => ({ ...value, items: value.items.slice(3) })), TOAST_MS);
    return () => clearTimeout(timer);
  }, [enabled, scope, queue]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {enabled &&
        queue.scope === scope &&
        queue.items.slice(0, 3).map((item) => (
          <div key={item.id} className="toast" style={{ ['--toast-ms' as string]: `${TOAST_MS}ms` }}>
            <button type="button" className="toast-body" onClick={() => follow(item)}>
              <span className="badge soft">
                {item.kind === 'summary' ? 'Resumo inteligente' : (notificationKindLabel[item.kind] ?? 'Notificação')}
              </span>
              <strong>{item.title}</strong>
              {item.body && <span className="small-text">{item.body}</span>}
              {item.reason && <span className="muted small-text">{item.reason}</span>}
            </button>
            <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(item.id)}>
              ×
            </button>
          </div>
        ))}
    </div>
  );
}
export function PopupSettings({ enabled = true }: { enabled?: boolean }) {
  const { permission, request, error } = usePopupPermission();
  if (!enabled)
    return (
      <p className="popup-settings muted small-text">
        Para receber no Windows / sistema, ative esse canal nos assuntos desejados e salve suas notificações.
      </p>
    );
  if (permission === 'granted')
    return (
      <p className="popup-settings muted small-text">
        Permissão concedida neste navegador. No Windows, o navegador entrega os avisos ao sistema; as configurações de notificações e de
        foco do Windows também se aplicam.
      </p>
    );
  if (permission === 'unsupported')
    return (
      <p className="popup-settings muted small-text">
        Este navegador ou endereço não oferece notificações do sistema. Use Chrome ou Edge com HTTPS (ou localhost no ambiente local). Os
        avisos dentro da página continuam disponíveis.
      </p>
    );
  if (permission === 'denied')
    return (
      <p className="popup-settings muted small-text">
        Notificações bloqueadas neste navegador. Nas permissões deste site, escolha Notificações → Permitir e volte à aplicação.
      </p>
    );
  return (
    <div className="popup-settings">
      <p className="small-text">
        Autorize este navegador a entregar os assuntos selecionados ao Windows / sistema, inclusive quando outra janela estiver na frente.
      </p>
      <button type="button" className="small" onClick={() => void request()}>
        Permitir notificações do sistema
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, notificationKindLabel, type NotificationItem, type Page } from './api';

/**
 * Notificações ao vivo: a cada 20 s busca as não lidas e avisa as novas de dois jeitos. Na tela, um aviso no canto
 * (some sozinho); no Windows, o pop-up do sistema, quando a pessoa permitiu no navegador. O pop-up do sistema só
 * existe enquanto o sistema está aberto em alguma aba, e só em endereço seguro (localhost ou https).
 */

const POLL_MS = 20_000;
const TOAST_MS = 7_000;
const SEEN_KEY = 'tradutor:notificacoes-vistas';

export type PopupPermission = NotificationPermission | 'unsupported';

const supported = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // Sem armazenamento local, só repete avisos ao recarregar a página.
  }
}

export function usePopupPermission() {
  const [permission, setPermission] = useState<PopupPermission>(() => (supported() ? Notification.permission : 'unsupported'));
  const request = useCallback(async () => {
    if (!supported()) return;
    setPermission(await Notification.requestPermission());
  }, []);
  return { permission, request };
}

export function LiveNotifications({
  onOpenTranslation,
  onOpenNotifications,
  onNew,
}: {
  onOpenTranslation: (id: string) => void;
  onOpenNotifications: () => void;
  onNew: () => void;
}) {
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const open = useRef({ onOpenTranslation, onOpenNotifications, onNew });
  open.current = { onOpenTranslation, onOpenNotifications, onNew };

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const follow = useCallback(
    (item: NotificationItem) => {
      dismiss(item.id);
      if (item.translationId) open.current.onOpenTranslation(item.translationId);
      else open.current.onOpenNotifications();
    },
    [dismiss],
  );

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const page = await api<Page<NotificationItem>>('GET', '/notifications?unread=true&limit=10').catch(() => null);
      if (!alive || !page) return;
      // Na primeira leitura, o que já estava não lido não vira aviso: só o que chegar depois.
      if (!seen.current) {
        seen.current = loadSeen();
        if (!seen.current.size) {
          page.items.forEach((item) => seen.current!.add(item.id));
          saveSeen(seen.current);
          return;
        }
      }
      const fresh = page.items.filter((item) => !seen.current!.has(item.id)).reverse();
      if (!fresh.length) return;
      fresh.forEach((item) => seen.current!.add(item.id));
      saveSeen(seen.current);
      open.current.onNew();
      setToasts((current) => [...current, ...fresh].slice(-4));
      if (supported() && Notification.permission === 'granted') {
        for (const item of fresh) {
          const popup = new Notification(item.title, {
            body: [notificationKindLabel[item.kind] ?? null, item.body].filter(Boolean).join(' · '),
            tag: `tradutor-${item.id}`,
          });
          popup.onclick = () => {
            window.focus();
            follow(item);
            popup.close();
          };
        }
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [follow]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
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

/** Convite para ligar os pop-ups do Windows, ou como reativar quando o navegador bloqueou. */
export function PopupSettings() {
  const { permission, request } = usePopupPermission();
  if (permission === 'granted') {
    return <p className="popup-settings muted small-text">Pop-ups no Windows ativados neste navegador.</p>;
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
      <span className="small-text">Receba os avisos como pop-up do Windows, mesmo com outra janela na frente.</span>
      <button type="button" className="small" onClick={() => void request()}>
        Ativar pop-ups no Windows
      </button>
    </div>
  );
}

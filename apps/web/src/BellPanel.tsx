import { useEffect, useState } from 'react';
import { api, notificationKindLabel, type NotificationItem, type Page } from './api';
import { Icon } from './icons';
import { LoadingHint, message } from './ui';

/** Assuntos que pedem uma ação de quem recebe; o resto é atualização. */
const NEEDS_ACTION = new Set([
  'translation_ready',
  'pattern_unknown',
  'translation_submitted',
  'translation_returned',
  'translation_failed',
  'review_blocked',
  'processing_stalled',
  'approval_waiting',
  'download_waiting',
  'unassigned_work',
  'translation_assigned',
  'quota_warning',
  'quota_exhausted',
  'numbering_request',
  'password_reset_requested',
]);

const when = (iso: string) => {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60 && date.getDate() === new Date().getDate())
    return `hoje, ${date.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}`;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
};

/** Sino: as notificações recentes em duas abas, com link para a lista completa. */
export function BellPanel({
  unread,
  version,
  onOpenTranslation,
  onOpenDocuments,
  onOpenPasswords,
  onSeeAll,
  onChange,
}: {
  unread: number;
  version: number;
  onOpenTranslation: (id: string) => void;
  onOpenDocuments: (batchId?: string) => void;
  onOpenPasswords: () => void;
  onSeeAll: () => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'need' | 'updates'>('need');
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<Page<NotificationItem>>('GET', '/notifications?limit=20')
      .then((page) => alive && (setItems(page.items), setError(null)))
      .catch((caught: unknown) => alive && setError(message(caught)));
    return () => {
      alive = false;
    };
  }, [open, version, reload]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false);
        return;
      }
      if (!(event.target as Element | null)?.closest?.('.bell-anchor')) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function markRead(ids?: string[]) {
    try {
      await api('POST', '/notifications/read', ids ? { ids } : {});
      setReload((value) => value + 1);
      onChange();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function follow(item: NotificationItem) {
    setOpen(false);
    if (!item.readAt) void markRead([item.id]);
    if (item.translationId) onOpenTranslation(item.translationId);
    else if (item.batchId) onOpenDocuments(item.batchId);
    else if (item.kind === 'password_reset_requested') onOpenPasswords();
    else onSeeAll();
  }

  const need = (items ?? []).filter((item) => NEEDS_ACTION.has(item.kind));
  const updates = (items ?? []).filter((item) => !NEEDS_ACTION.has(item.kind));
  const list = tab === 'need' ? need : updates;

  return (
    <div className="anchor bell-anchor">
      <button
        type="button"
        className="icon-button"
        aria-label={unread ? `Notificações, ${unread} novas` : 'Notificações'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover bell-panel" role="dialog" aria-label="Notificações">
          <header>
            <h2>Notificações</h2>
            <button type="button" className="small ghost" disabled={!unread} onClick={() => void markRead()}>
              Marcar todas como lidas
            </button>
          </header>
          <div className="tabs" role="tablist" aria-label="Tipo de notificação">
            <button type="button" role="tab" aria-selected={tab === 'need'} onClick={() => setTab('need')}>
              Precisa de você <span className="nav-count">{need.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'updates'} onClick={() => setTab('updates')}>
              Atualizações <span className="nav-count">{updates.length}</span>
            </button>
          </div>
          {error && <p className="cmdk-empty error-text">{error}</p>}
          {!items && !error && (
            <p className="cmdk-empty">
              <LoadingHint />
            </p>
          )}
          {items && (
            <ul className="bell-list">
              {list.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`note-row ${item.readAt ? '' : 'unread'}`} onClick={() => follow(item)}>
                    <span className="note-dot" aria-hidden="true" />
                    <span className="note-main">
                      <span className="note-kind">{notificationKindLabel[item.kind] ?? item.kind}</span>
                      <span className="note-title">{item.title}</span>
                    </span>
                    <span className="note-when">{when(item.createdAt)}</span>
                  </button>
                </li>
              ))}
              {!list.length && (
                <li className="cmdk-empty">{tab === 'need' ? 'Nada esperando por você.' : 'Nenhuma atualização recente.'}</li>
              )}
            </ul>
          )}
          <footer>
            <button
              type="button"
              className="small"
              style={{ width: '100%' }}
              onClick={() => {
                setOpen(false);
                onSeeAll();
              }}
            >
              Ver todas as notificações
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

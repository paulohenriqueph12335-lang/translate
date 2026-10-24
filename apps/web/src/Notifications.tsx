import { useEffect, useState } from 'react';
import { api, notificationKindLabel, queryString, type NotificationItem } from './api';
import { PopupSettings } from './LiveNotifications';
import { useNotificationSettings } from './notification-preferences';
import { dateTime, Feedback, message, PagedFooter, Section, Segmented, usePaged } from './ui';

/** Quantidade de notificações não lidas, atualizada periodicamente e quando `version` muda. */
export function useUnreadCount(version: number) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ unread: number }>('GET', '/notifications/unread-count')
        .then((result) => alive && setUnread(result.unread))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [version]);
  return unread;
}

const KIND_TONE: Record<string, string> = {
  pattern_unknown: 'warn',
  translation_failed: 'danger',
  translation_returned: 'warn',
  translation_approved: '',
  translation_submitted: 'info',
};

export function Notifications({
  onOpenTranslation,
  onOpenDocuments,
  onChange,
}: {
  onOpenTranslation: (id: string) => void;
  onOpenDocuments: (batchId?: string) => void;
  onChange: () => void;
}) {
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const settings = useNotificationSettings();
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = usePaged<NotificationItem>(
    `/notifications${queryString({ limit: 30, unread: filter === 'unread', kind, category })}`,
    version,
  );

  async function markRead(ids?: string[]) {
    try {
      await api('POST', '/notifications/read', ids ? { ids } : {});
      setVersion((current) => current + 1);
      onChange();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function open(item: NotificationItem) {
    if (!item.readAt) void markRead([item.id]);
    if (item.translationId) onOpenTranslation(item.translationId);
    else if (item.batchId) onOpenDocuments(item.batchId);
  }

  return (
    <Section title="Notificações" subtitle="Documentos prontos, tipos novos, pedidos para refazer, conclusões e falhas.">
      <PopupSettings
        enabled={Boolean(settings.data?.notificationsEnabled && Object.values(settings.data.categories).some((item) => item.browser))}
      />
      <div className="filters">
        <Segmented
          label="Mostrar"
          value={filter}
          options={[
            ['unread', 'Não lidas'],
            ['all', 'Todas'],
          ]}
          onChange={setFilter}
        />
        <select aria-label="Tipo de notificação" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(notificationKindLabel).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Assunto da notificação" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todos os assuntos</option>
          {settings.data?.catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="small" onClick={() => void markRead()}>
          Marcar todas como lidas
        </button>
      </div>
      <Feedback error={error ?? list.error ?? settings.error} />
      <ul className="list selectable notifications">
        {list.items.map((item) => (
          <li key={item.id} className={item.readAt ? 'read' : 'unread'} onClick={() => open(item)}>
            <div>
              <strong>
                <span className={`badge ${KIND_TONE[item.kind] ?? 'soft'}`}>{notificationKindLabel[item.kind] ?? item.kind}</span>{' '}
                {item.title}
              </strong>
              {item.body && <span>{item.body}</span>}
              {item.reason && <span className="small-text">Por que recebi: {item.reason}</span>}
              <span className="muted small-text">
                {dateTime(item.createdAt)}
                {item.team ? ` · ${item.team.name}` : ''}
              </span>
            </div>
            {!item.readAt && (
              <button
                className="small ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  void markRead([item.id]);
                }}
              >
                Marcar como lida
              </button>
            )}
          </li>
        ))}
      </ul>
      <PagedFooter
        hasMore={list.hasMore}
        loading={list.loading}
        onMore={list.more}
        empty={list.items.length === 0}
        emptyText={filter === 'unread' ? 'Nenhuma notificação nova.' : 'Nenhuma notificação.'}
      />
    </Section>
  );
}

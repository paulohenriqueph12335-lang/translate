import { useState } from 'react';
import {
  api,
  notificationKindLabel,
  pairLabel,
  queryString,
  type Me,
  type NotificationItem,
  type NumberingOverview,
  type Page,
  type TranslationSummary,
} from './api';
import { AiChoice } from './AiComparison';
import { useConfirm } from './ConfirmDialog';
import { Meter } from './Charts';
import { StatusBadge } from './Translations';
import { LanguagePairPicker } from './LanguagePairPicker';
import { dateTime, DateRange, Feedback, message, PagedFooter, SearchInput, Section, TagList, useDebounced, useLoad, usePaged } from './ui';

const ACTIVE = 'queued,processing,in_review,awaiting_approval';

/**
 * Meu workspace (plano de hierarquia): enviar documentos, o que está comigo, o que a equipe pode assumir,
 * minha cota de numeração e as notificações novas.
 */
export function Workspace({
  me,
  onOpenTranslation,
  onUpload,
  onNotifications,
}: {
  me: Me;
  onOpenTranslation: (id: string) => void;
  onUpload: () => void;
  onNotifications: () => void;
}) {
  const [version, setVersion] = useState(0);
  const confirm = useConfirm();
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const mine = usePaged<TranslationSummary>(`/translations?mine=true&status=${ACTIVE}&limit=50`, version);
  const open = usePaged<TranslationSummary>(`/translations?unclaimed=true&status=${ACTIVE}&limit=50`, version);
  const totals = useLoad(() => api<{ totals: { inProgress: number; inReview: number } }>('GET', '/dashboards/individual'), [version]);
  const quota = useLoad(() => api<NumberingOverview>('GET', '/numbering'), [version]);
  const news = useLoad(() => api<Page<NotificationItem>>('GET', '/notifications?unread=true&limit=5'), [version]);
  const unread = useLoad(() => api<{ unread: number }>('GET', '/notifications/unread-count'), [version]);

  async function claim(item: TranslationSummary) {
    const completed = item.status === 'awaiting_approval' || item.status === 'approved';
    if (completed && !(await confirm('Este documento já está pronto. Deseja alterar o responsável?'))) return;
    try {
      await api('POST', `/translations/${item.id}/claim`, completed ? { confirmCompleted: true } : {});
      setFeedback({ ok: `"${item.document.name}" agora é sua.` });
      setVersion((current) => current + 1);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Meu workspace" subtitle="Seus documentos, o que espera por você e o que a equipe pode assumir.">
      <div className="stat-row">
        <button className="card stat-tile action-tile" onClick={onUpload}>
          <span className="muted small-text">Começar</span>
          <strong>Nova tradução</strong>
          <span className="muted small-text">PDF, DOCX, PPTX ou imagem</span>
        </button>
        <div className="card stat-tile">
          <span className="muted small-text">Para revisar</span>
          <strong>{totals.data?.totals.inReview ?? '—'}</strong>
          <span className="muted small-text">
            {totals.data ? totals.data.totals.inProgress - totals.data.totals.inReview : '—'} em outras etapas
          </span>
        </div>
        <div className="card stat-tile">
          <span className="muted small-text">Minha numeração {quota.data?.year}</span>
          {quota.data && <Meter used={quota.data.mine.used} quota={quota.data.mine.quota} />}
        </div>
        <button className="card stat-tile action-tile" onClick={onNotifications}>
          <span className="muted small-text">Notificações novas</span>
          <strong>{unread.data?.unread ?? '—'}</strong>
          <span className="muted small-text">ver todas</span>
        </button>
      </div>
      <Feedback
        error={mine.error ?? open.error ?? totals.error ?? quota.error ?? news.error ?? unread.error ?? feedback.error ?? null}
        ok={feedback.ok ?? null}
      />
      <details className="secondary-options workspace-preferences">
        <summary>Preferência de uso da IA</summary>
        <AiChoice />
      </details>

      <h3 className="top-gap">Comigo</h3>
      <WorkList items={mine.items} onOpen={onOpenTranslation} empty="Nada com você agora. Envie documentos ou assuma um da equipe." />
      <PagedFooter hasMore={mine.hasMore} loading={mine.loading} onMore={mine.more} empty={false} emptyText="" />

      {open.items.length > 0 && (
        <>
          <h3 className="top-gap">Disponíveis para assumir</h3>
          <WorkList items={open.items} onOpen={onOpenTranslation} onClaim={claim} empty="" />
          <PagedFooter hasMore={open.hasMore} loading={open.loading} onMore={open.more} empty={false} emptyText="" />
        </>
      )}

      {(news.data?.items.length ?? 0) > 0 && (
        <details className="secondary-options workspace-news">
          <summary>Prévia das últimas notificações</summary>
          <ul className="list compact">
            {news.data!.items.map((item) => (
              <li key={item.id} className="clickable" onClick={() => item.translationId && onOpenTranslation(item.translationId)}>
                <div>
                  <strong>
                    <span className="badge soft">{notificationKindLabel[item.kind] ?? item.kind}</span> {item.title}
                  </strong>
                  <span className="muted small-text">{dateTime(item.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function WorkList({
  items,
  onOpen,
  onClaim,
  empty,
}: {
  items: TranslationSummary[];
  onOpen: (id: string) => void;
  onClaim?: (item: TranslationSummary) => void;
  empty: string;
}) {
  if (!items.length) return empty ? <p className="empty">{empty}</p> : null;
  return (
    <ul className="list selectable work-list">
      {items.map((item) => (
        <li key={item.id} onClick={() => onOpen(item.id)}>
          <div>
            <strong>
              {item.document.name} <StatusBadge status={item.status} />
              {item.patternKnown === false && <span className="badge warn">Tipo novo</span>}
            </strong>
            <span className="muted">
              {item.documentType ?? item.sourceTitle ?? 'Tipo ainda não identificado'} ·{' '}
              {pairLabel(item.sourceLanguage, item.targetLanguage)} · {item.team?.name ?? 'Sem equipe'} · {dateTime(item.createdAt)}
            </span>
            <TagList tags={item.document.tags} />
          </div>
          {onClaim ? (
            <button
              className="small primary"
              onClick={(event) => {
                event.stopPropagation();
                onClaim(item);
              }}
            >
              Assumir
            </button>
          ) : (
            <button className="small">Abrir</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Histórico: o que a pessoa finalizou, com idioma, número usado e acesso à prévia e ao arquivo final. */
export function History({ onOpenTranslation }: { onOpenTranslation: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [pair, setPair] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const list = usePaged<TranslationSummary>(
    `/translations${queryString({
      limit: 30,
      mine: true,
      status: 'approved',
      q,
      sourceLanguage: pair ? pair.slice(0, 2) : undefined,
      targetLanguage: pair ? pair.slice(3) : undefined,
      approvedFrom: period.from,
      approvedTo: period.to,
    })}`,
  );
  const filtered = !!(q || pair || period.from || period.to);

  return (
    <Section title="Histórico" subtitle="Documentos que você finalizou, com idioma, número da Tradução Pública e prévia.">
      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Arquivo, tipo ou nº (0001/2026)" />
        <LanguagePairPicker label="Idiomas" value={pair} onChange={setPair} any="Todos os idiomas" />
        <DateRange label="Concluídas" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setPair('');
              setPeriod({ from: '', to: '' });
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº / protocolo</th>
              <th>Documento</th>
              <th>Idiomas</th>
              <th>Concluída</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td className="nowrap">
                  {item.number?.split(' – ')[0]}
                  <span className="muted small-text block-line">{item.number?.split(' – ').slice(1).join(' · ')}</span>
                  {item.annulled && <span className="badge danger">Anulado</span>}
                </td>
                <td className="name-cell">
                  {item.document.name}
                  <span className="muted small-text block-line">{item.documentType ?? '—'}</span>
                </td>
                <td>{pairLabel(item.sourceLanguage, item.targetLanguage)}</td>
                <td className="nowrap">
                  {item.approvedAt ? dateTime(item.approvedAt) : '—'}
                  <span className="muted small-text block-line">{item.approvedBy}</span>
                </td>
                <td className="actions">
                  <button className="small" onClick={() => onOpenTranslation(item.id)}>
                    Ver prévia
                  </button>
                  {item.permissions.download && (
                    <a className="button small primary" href={`/api/v1/translations/${item.id}/final`}>
                      Baixar
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PagedFooter
        hasMore={list.hasMore}
        loading={list.loading}
        onMore={list.more}
        empty={list.items.length === 0}
        emptyText={filtered ? 'Nada corresponde aos filtros.' : 'Você ainda não finalizou nenhuma tradução.'}
      />
    </Section>
  );
}

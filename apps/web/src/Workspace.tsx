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
  LANGUAGE_PAIRS,
} from './api';
import { AiChoice } from './AiComparison';
import { Meter } from './Charts';
import { StatusBadge } from './Translations';
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
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const mine = useLoad(() => api<Page<TranslationSummary>>('GET', `/translations?mine=true&status=${ACTIVE}&limit=50`), [version]);
  const open = useLoad(() => api<Page<TranslationSummary>>('GET', `/translations?unclaimed=true&status=${ACTIVE}&limit=50`), [version]);
  const quota = useLoad(() => api<NumberingOverview>('GET', '/numbering'), [version]);
  const news = useLoad(() => api<Page<NotificationItem>>('GET', '/notifications?unread=true&limit=5'), [version]);

  async function claim(item: TranslationSummary) {
    try {
      await api('POST', `/translations/${item.id}/claim`);
      setFeedback({ ok: `"${item.document.name}" agora é sua.` });
      setVersion((current) => current + 1);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  const waiting = (mine.data?.items ?? []).filter((item) => item.status === 'in_review');
  return (
    <Section title="Meu workspace" subtitle="Seus documentos, o que espera por você e o que a equipe pode assumir.">
      <div className="stat-row">
        <button className="card stat-tile action-tile" onClick={onUpload}>
          <span className="muted small-text">Novo envio</span>
          <strong>Enviar documentos</strong>
          <span className="muted small-text">PDF, DOCX, PPTX ou imagem</span>
        </button>
        <div className="card stat-tile">
          <span className="muted small-text">Para revisar</span>
          <strong>{waiting.length}</strong>
          <span className="muted small-text">{(mine.data?.items.length ?? 0) - waiting.length} em outras etapas</span>
        </div>
        <div className="card stat-tile">
          <span className="muted small-text">Minha numeração {quota.data?.year}</span>
          {quota.data && <Meter used={quota.data.mine.used} quota={quota.data.mine.quota} />}
        </div>
        <button className="card stat-tile action-tile" onClick={onNotifications}>
          <span className="muted small-text">Notificações novas</span>
          <strong>{news.data?.items.length ?? 0}</strong>
          <span className="muted small-text">ver todas</span>
        </button>
      </div>
      <Feedback error={mine.error ?? open.error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <AiChoice />

      <h3 className="top-gap">Comigo</h3>
      <WorkList
        items={mine.data?.items ?? []}
        onOpen={onOpenTranslation}
        empty="Nada com você agora. Envie documentos ou assuma um da equipe."
      />

      {(open.data?.items.length ?? 0) > 0 && (
        <>
          <h3 className="top-gap">Disponíveis para assumir</h3>
          <WorkList items={open.data!.items} onOpen={onOpenTranslation} onClaim={claim} empty="" />
        </>
      )}

      {(news.data?.items.length ?? 0) > 0 && (
        <>
          <h3 className="top-gap">Notificações novas</h3>
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
        </>
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
        <select aria-label="Idiomas" value={pair} onChange={(e) => setPair(e.target.value)}>
          <option value="">Todos os idiomas</option>
          {LANGUAGE_PAIRS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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

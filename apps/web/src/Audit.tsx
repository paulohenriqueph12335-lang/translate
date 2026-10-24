import { useEffect, useState } from 'react';
import {
  api,
  auditActionLabel,
  auditCategoryLabel,
  failureLabel,
  queryString,
  type AuditEvent,
  type Me,
  type Page,
  type Team,
  type User,
} from './api';
import { dateTime, DateRange, Feedback, PagedFooter, SearchInput, Section, useDebounced, useLoad, usePaged } from './ui';
import { duration } from './Charts';

type Severity = 'info' | 'warning' | 'error' | 'critical';
const severityLabel: Record<Severity, string> = { info: 'Informação', warning: 'Atenção', error: 'Erro', critical: 'Emergência' };
type ClassifiedEvent = AuditEvent & { severity: Severity; failureCode: string | null };
interface AuditSummary {
  total: number;
  errors: number;
  warnings: number;
  critical: number;
  bySeverity: Record<Severity, number>;
  byFailureCode: Array<{ code: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
}
interface Incidents {
  total: number;
  critical: number;
  errors: number;
  warnings: number;
  criteria: { stalledMinutes: number; undownloadedHours: number; consecutiveFailures: number };
  items: Array<{
    id: string;
    translationId: string;
    documentId: string;
    name: string;
    protocol: string | null;
    team: { id: string; name: string } | null;
    status: string;
    severity: Severity;
    code: string;
    cause: string;
    since: string;
    ageMinutes: number;
  }>;
}

const TARGET_LABEL: Record<string, string> = {
  user: 'Usuário',
  team: 'Equipe',
  batch: 'Lote',
  document: 'Documento',
  translation: 'Tradução',
  translation_archive: 'Pacote ZIP',
  pattern_trial: 'Ensaio de formatação',
  glossary: 'Glossário',
  settings: 'Configurações',
  session: 'Sessão',
};

/** Detalhes do evento em texto curto, sem chaves técnicas desnecessárias. */
const details = (metadata: Record<string, unknown>) =>
  Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ');

export function Audit({
  me,
  initialSearch = '',
  onOpenTranslation,
}: {
  me: Me;
  initialSearch?: string;
  onOpenTranslation?: (id: string) => void;
}) {
  const isDirector = me.user.orgRole === 'director';
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  const q = useDebounced(search.trim());
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [teamId, setTeamId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [severity, setSeverity] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [failureCode, setFailureCode] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const facets = useLoad(
    () => api<{ actions: string[]; targetTypes: string[]; failureCodes: string[] }>('GET', '/audit-events/facets'),
    [],
  );
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  // Diretor escolhe entre todos; Supervisor, entre as pessoas das equipes que supervisiona (vê só a auditoria delas).
  const users = useLoad(async () => {
    if (isDirector)
      return (await api<Page<User>>('GET', '/users?limit=100')).items.map((user) => ({ id: user.id, name: user.displayName }));
    const led = me.memberships.filter((m) => m.role === 'leader');
    const lists = await Promise.all(
      led.map((m) => api<{ items: Array<{ userId: string; displayName: string }> }>('GET', `/teams/${m.teamId}/members`)),
    );
    const people = new Map(lists.flatMap((list) => list.items.map((item) => [item.userId, item.displayName] as [string, string])));
    return [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [isDirector]);
  const filterQuery = queryString({
    q,
    category,
    action,
    actorId: actor === '__system' ? undefined : actor,
    system: actor === '__system',
    teamId,
    targetType,
    from: period.from,
    to: period.to,
    severity,
    errorsOnly,
    failureCode,
  });
  const list = usePaged<ClassifiedEvent>(`/audit-events${filterQuery}${filterQuery ? '&' : '?'}limit=50`);
  const summary = useLoad(() => api<AuditSummary>('GET', `/audit-events/summary${filterQuery}`), [filterQuery]);
  const incidents = useLoad(() => api<Incidents>('GET', `/audit-events/incidents${queryString({ teamId, limit: 30 })}`), [teamId]);
  const actions = (facets.data?.actions ?? []).filter((value) => !category || value.startsWith(`${category}.`));
  const categories = [...new Set((facets.data?.actions ?? []).map((value) => value.split('.')[0]!))];
  const filtered = !!(
    q ||
    category ||
    action ||
    actor ||
    teamId ||
    targetType ||
    period.from ||
    period.to ||
    severity ||
    errorsOnly ||
    failureCode
  );

  return (
    <div className="administration-view audit-view">
      <Section
        title="Auditoria"
        subtitle={
          isDirector
            ? 'Registro somente inserção de tudo o que acontece no sistema.'
            : 'Registro somente inserção do que acontece nas equipes que você supervisiona.'
        }
      >
        <div className="filters audit-filters">
          <button
            type="button"
            className="small"
            onClick={() => {
              list.reload();
              summary.reload();
              incidents.reload();
              facets.reload();
            }}
          >
            Atualizar auditoria
          </button>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar protocolo, arquivo, pessoa, ação ou erro" />
          <select aria-label="Gravidade" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Todas as gravidades</option>
            {(Object.keys(severityLabel) as Severity[]).map((value) => (
              <option key={value} value={value}>
                {severityLabel[value]}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            Somente erros e emergências
          </label>
          <select aria-label="Causa do erro" value={failureCode} onChange={(e) => setFailureCode(e.target.value)}>
            <option value="">Todas as causas</option>
            {facets.data?.failureCodes?.map((value) => (
              <option key={value} value={value}>
                {failureLabel[value] ?? value}
              </option>
            ))}
          </select>
          <select
            aria-label="Grupo de ações"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setAction('');
            }}
          >
            <option value="">Todos os grupos</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {auditCategoryLabel[value] ?? value}
              </option>
            ))}
          </select>
          <select aria-label="Ação" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todas as ações</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {auditActionLabel[value] ?? value}
              </option>
            ))}
          </select>
          <select aria-label="Quem" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Qualquer pessoa</option>
            <option value="__system">Sistema (processamento)</option>
            {users.data?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <select aria-label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Todas as equipes</option>
            {teams.data?.items
              .filter((team) => isDirector || team.myRole === 'leader')
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
          <select aria-label="Alvo" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">Qualquer alvo</option>
            {facets.data?.targetTypes.map((value) => (
              <option key={value} value={value}>
                {TARGET_LABEL[value] ?? value}
              </option>
            ))}
          </select>
          <DateRange label="Período" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
          {filtered && (
            <button
              className="link"
              onClick={() => {
                setSearch('');
                setCategory('');
                setAction('');
                setActor('');
                setTeamId('');
                setTargetType('');
                setPeriod({ from: '', to: '' });
                setSeverity('');
                setErrorsOnly(false);
                setFailureCode('');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
        <Feedback error={list.error ?? summary.error ?? incidents.error ?? facets.error} />
        {summary.data && (
          <div className="stat-row audit-summary" aria-label="Totais de todos os registros filtrados">
            <div className="card stat-tile">
              <span>Eventos nos filtros</span>
              <strong>{summary.data.total}</strong>
              <small>Todas as páginas</small>
            </div>
            <div className="card stat-tile">
              <span>Erros</span>
              <strong>{summary.data.errors}</strong>
              <small>Inclui emergências</small>
            </div>
            <div className="card stat-tile">
              <span>Emergências</span>
              <strong>{summary.data.critical}</strong>
              <small>Registros críticos</small>
            </div>
            <div className="card stat-tile">
              <span>Atenções</span>
              <strong>{summary.data.warnings}</strong>
              <small>Revisões e exceções</small>
            </div>
          </div>
        )}
        {summary.data && summary.data.byFailureCode.length > 0 && (
          <details className="top-gap">
            <summary>Quantidade por causa do erro</summary>
            <ul className="list compact">
              {summary.data.byFailureCode.map((row) => (
                <li key={row.code}>
                  <button className="link" onClick={() => setFailureCode(row.code)}>
                    {failureLabel[row.code] ?? row.code}
                  </button>
                  <strong>{row.count}</strong>
                </li>
              ))}
            </ul>
          </details>
        )}
        {incidents.data && (
          <details className="audit-incidents top-gap" open={incidents.data.critical > 0}>
            <summary>
              Pendências operacionais agora: {incidents.data.total} · {incidents.data.critical} emergente(s)
            </summary>
            <p className="muted small-text">
              Retrabalho: pelo menos {incidents.data.criteria.consecutiveFailures} devoluções. Fila/processamento:{' '}
              {incidents.data.criteria.stalledMinutes} minutos sem atualização. Concluído: {incidents.data.criteria.undownloadedHours} horas
              sem download. Esta visão usa a equipe selecionada e o estado atual, independente dos filtros históricos.
            </p>
            <ul className="list">
              {incidents.data.items.map((item) => (
                <li className={`audit-incident ${item.severity}`} key={item.id}>
                  <div>
                    <span className={`badge severity-badge ${item.severity}`}>{severityLabel[item.severity]}</span>{' '}
                    {onOpenTranslation ? (
                      <button className="link" onClick={() => onOpenTranslation(item.translationId)}>
                        {item.protocol ? `${item.protocol} — ` : ''}
                        {item.name}
                      </button>
                    ) : (
                      <strong>
                        {item.protocol ? `${item.protocol} — ` : ''}
                        {item.name}
                      </strong>
                    )}
                    <p>{item.cause}</p>
                    <small className="muted">
                      {item.code} · {item.team?.name ?? 'Sem equipe'} · desde {dateTime(item.since)} · {duration(item.ageMinutes)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            {incidents.data.total > incidents.data.items.length && (
              <p className="muted small-text">
                Mostrando as {incidents.data.items.length} pendências prioritárias de {incidents.data.total}.
              </p>
            )}
            {!incidents.data.total && <p className="empty">Nenhuma pendência pelos critérios acima.</p>}
          </details>
        )}
        <div className="table-wrap audit-records">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Gravidade / erro</th>
                <th>Equipe</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((event) => (
                <tr key={event.id}>
                  <td className="nowrap">{dateTime(event.occurredAt)}</td>
                  <td>{event.actor?.displayName ?? <span className="muted">Sistema</span>}</td>
                  <td>
                    <button className="link" title={event.action} onClick={() => setAction(event.action)}>
                      {auditActionLabel[event.action] ?? event.action}
                    </button>
                    {event.targetType && (
                      <span className="muted small-text block-line">
                        {TARGET_LABEL[event.targetType] ?? event.targetType} {event.targetId?.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge severity-badge ${event.severity}`}>{severityLabel[event.severity] ?? 'Informação'}</span>
                    {event.failureCode && (
                      <button className="link block-line small-text" onClick={() => setFailureCode(event.failureCode!)}>
                        {event.failureCode}
                      </button>
                    )}
                  </td>
                  <td>{event.team?.name ?? '—'}</td>
                  <td className="muted small-text details-cell">{details(event.metadata) || '—'}</td>
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
          emptyText={filtered ? 'Nenhum evento corresponde aos filtros.' : 'Nenhum evento registrado.'}
        />
      </Section>
    </div>
  );
}

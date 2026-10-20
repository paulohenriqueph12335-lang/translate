import { useState } from 'react';
import { api, auditActionLabel, auditCategoryLabel, queryString, type AuditEvent, type Me, type Page, type Team, type User } from './api';
import { dateTime, DateRange, Feedback, PagedFooter, SearchInput, Section, useDebounced, useLoad, usePaged } from './ui';

const TARGET_LABEL: Record<string, string> = {
  user: 'Usuário',
  team: 'Equipe',
  batch: 'Lote',
  document: 'Documento',
  translation: 'Tradução',
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

export function Audit({ me }: { me: Me }) {
  const isDirector = me.user.orgRole === 'director';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [teamId, setTeamId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const facets = useLoad(() => api<{ actions: string[]; targetTypes: string[] }>('GET', '/audit-events/facets'), []);
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
  const list = usePaged<AuditEvent>(
    `/audit-events${queryString({
      limit: 50,
      q,
      category,
      action,
      actorId: actor === '__system' ? undefined : actor,
      system: actor === '__system',
      teamId,
      targetType,
      from: period.from,
      to: period.to,
    })}`,
  );
  const actions = (facets.data?.actions ?? []).filter((value) => !category || value.startsWith(`${category}.`));
  const categories = [...new Set((facets.data?.actions ?? []).map((value) => value.split('.')[0]!))];
  const filtered = !!(q || category || action || actor || teamId || targetType || period.from || period.to);

  return (
    <Section
      title="Auditoria"
      subtitle={
        isDirector
          ? 'Registro somente inserção de tudo o que acontece no sistema.'
          : 'Registro somente inserção do que acontece nas equipes que você supervisiona.'
      }
    >
      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar pessoa ou ação" />
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
              <th>Quando</th>
              <th>Quem</th>
              <th>Ação</th>
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
  );
}

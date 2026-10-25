import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, roleLabel, statusLabel, type Page, type Team, type TeamMember, type TeamRole } from './api';
import { Feedback, LoadingHint, message, normalize, SearchInput, Section, Segmented, useDebounced, useLoad } from './ui';

interface Candidate {
  userId: string;
  email: string;
  displayName: string;
  teamCount: number;
  teams?: string[];
}

type Assignment = 'any' | 'unassigned' | 'assigned';
type FeedbackState = { error?: string; ok?: string };

const matches = (query: string, ...fields: string[]) => {
  const needle = normalize(query.trim());
  return !needle || fields.some((field) => normalize(field).includes(needle));
};

export function Teams({ isDirector, selfId }: { isDirector: boolean; selfId: string }) {
  const { data, error, reload } = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | TeamRole | 'empty'>('all');
  const [feedback, setFeedback] = useState<FeedbackState>({});

  const teams = useMemo(
    () =>
      (data?.items ?? []).filter(
        (team) =>
          matches(search, team.name) &&
          (roleFilter === 'all' || (roleFilter === 'empty' ? team.memberCount === 0 : team.myRole === roleFilter)),
      ),
    [data, search, roleFilter],
  );
  const team = data?.items.find((item) => item.id === selected) ?? null;

  // Seleciona a primeira equipe visível para que a gestão já apareça aberta.
  useEffect(() => {
    if (!team && teams[0]) setSelected(teams[0].id);
  }, [team, teams]);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api<{ team: Team }>('POST', '/teams', { name });
      setName('');
      setFeedback({ ok: `Equipe "${created.team.name}" criada.` });
      setSelected(created.team.id);
      reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  const roleOptions: Array<['all' | TeamRole | 'empty', string]> = isDirector
    ? [
        ['all', 'Todas'],
        ['empty', 'Sem membros'],
      ]
    : [
        ['all', 'Todas'],
        ['leader', 'Lidero'],
        ['operator', 'Opero'],
      ];

  return (
    <div className="administration-view teams-view">
      <Section title="Equipes" subtitle={isDirector ? 'Você administra todas as equipes.' : 'Equipes das quais você participa.'}>
        {isDirector && (
          <form className="toolbar team-create" onSubmit={create}>
            <input
              placeholder="Nome da nova equipe"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary">Criar equipe</button>
          </form>
        )}
        <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
        {data && data.items.length === 0 && (
          <p className="empty">{isDirector ? 'Nenhuma equipe criada ainda.' : 'Você ainda não participa de equipes.'}</p>
        )}
        {data && data.items.length > 0 && (
          <div className="split teams-layout">
            <div className="stack team-directory">
              <div className="filters">
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar equipe" />
                <Segmented label="Filtrar equipes" value={roleFilter} options={roleOptions} onChange={setRoleFilter} />
              </div>
              <ul className="list selectable team-list">
                {teams.map((item) => (
                  <li key={item.id} className={item.id === selected ? 'selected' : ''} onClick={() => setSelected(item.id)}>
                    <div>
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.memberCount} membro(s){item.myRole ? ` · você é ${roleLabel[item.myRole]}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {teams.length === 0 && <p className="empty">Nenhuma equipe corresponde aos filtros.</p>}
            </div>
            {team && <TeamDetail key={team.id} team={team} isDirector={isDirector} selfId={selfId} onChange={reload} />}
          </div>
        )}
      </Section>
    </div>
  );
}

function TeamDetail({ team, isDirector, selfId, onChange }: { team: Team; isDirector: boolean; selfId: string; onChange: () => void }) {
  const canManage = isDirector || team.myRole === 'leader';
  const [tab, setTab] = useState<'members' | 'add'>('members');
  const [version, setVersion] = useState(0);
  const refresh = () => {
    setVersion((current) => current + 1);
    onChange();
  };

  if (!canManage) {
    return (
      <div className="card detail team-detail">
        <h3>{team.name}</h3>
        <p className="muted">Você participa como Usuário. A gestão de membros cabe ao Supervisor da equipe.</p>
      </div>
    );
  }

  return (
    <div className="card detail team-detail">
      <h3>{team.name}</h3>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>
          Membros ({team.memberCount})
        </button>
        <button role="tab" aria-selected={tab === 'add'} className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>
          Adicionar pessoas
        </button>
      </div>
      {tab === 'members' ? (
        <Members team={team} isDirector={isDirector} selfId={selfId} version={version} onChange={refresh} />
      ) : (
        <AddPeople team={team} isDirector={isDirector} onChange={refresh} />
      )}
    </div>
  );
}

function Members({
  team,
  isDirector,
  selfId,
  version,
  onChange,
}: {
  team: Team;
  isDirector: boolean;
  selfId: string;
  version: number;
  onChange: () => void;
}) {
  const { data, error, reload } = useLoad(() => api<{ items: TeamMember[] }>('GET', `/teams/${team.id}/members`), [team.id, version]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | TeamRole>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [feedback, setFeedback] = useState<FeedbackState>({});

  const all = data?.items ?? [];
  const members = all.filter(
    (member) =>
      matches(search, member.displayName, member.email) &&
      (role === 'all' || member.role === role) &&
      (status === 'all' || (status === 'active') === (member.status === 'active')),
  );
  const filtered = search !== '' || role !== 'all' || status !== 'all';

  async function run(label: string, call: () => Promise<unknown>) {
    try {
      await call();
      setFeedback({ ok: label });
      reload();
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <>
      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome ou e-mail" />
        <Segmented
          label="Função"
          value={role}
          options={[
            ['all', 'Todas as funções'],
            ['leader', 'Supervisores'],
            ['operator', 'Usuários'],
          ]}
          onChange={setRole}
        />
        <Segmented
          label="Situação"
          value={status}
          options={[
            ['all', 'Qualquer situação'],
            ['active', 'Ativos'],
            ['inactive', 'Inativos'],
          ]}
          onChange={setStatus}
        />
      </div>
      <div className="count">
        <span>{filtered ? `Mostrando ${members.length} de ${all.length}` : `${all.length} membro(s)`}</span>
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setRole('all');
              setStatus('all');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <ul className="list compact team-members">
        {members.map((member) => {
          const removable = isDirector || (member.role === 'operator' && member.userId !== selfId);
          return (
            <li key={member.userId}>
              <div>
                <strong>
                  {member.displayName} {member.userId === selfId && <span className="badge soft">Você</span>}{' '}
                  <span className={`badge ${member.role === 'leader' ? '' : 'soft'}`}>{roleLabel[member.role]}</span>
                  {member.status !== 'active' && <span className="badge warn">{statusLabel[member.status]}</span>}
                </strong>
                <span className="muted">{member.email}</span>
              </div>
              <div className="actions">
                {isDirector && (
                  <button
                    className="small"
                    onClick={() =>
                      run('Função alterada.', () =>
                        api('PATCH', `/teams/${team.id}/members/${member.userId}`, {
                          role: member.role === 'leader' ? 'operator' : 'leader',
                        }),
                      )
                    }
                  >
                    {member.role === 'leader' ? 'Tornar Usuário' : 'Tornar Supervisor'}
                  </button>
                )}
                {removable && (
                  <button
                    className="danger small"
                    onClick={() =>
                      run(`${member.displayName} removido(a) da equipe.`, () => api('DELETE', `/teams/${team.id}/members/${member.userId}`))
                    }
                  >
                    Remover
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {data && all.length === 0 && <p className="empty">Equipe sem membros. Use “Adicionar pessoas”.</p>}
      {data && all.length > 0 && members.length === 0 && <p className="empty">Nenhum membro corresponde aos filtros.</p>}
    </>
  );
}

function AddPeople({ team, isDirector, onChange }: { team: Team; isDirector: boolean; onChange: () => void }) {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const [assignment, setAssignment] = useState<Assignment>('any');
  const [role, setRole] = useState<TeamRole>('operator');
  const [items, setItems] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({});
  const [email, setEmail] = useState('');
  const [version, setVersion] = useState(0);
  const effectiveRole: TeamRole = isDirector ? role : 'operator';

  async function load(from: string | null) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50', assignment });
      if (query) params.set('q', query);
      if (from) params.set('cursor', from);
      const page = await api<Page<Candidate>>('GET', `/teams/${team.id}/candidates?${params}`);
      setItems((current) => (from ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelected(new Set());
    void load(null);
  }, [team.id, query, assignment, version]);

  const toggle = (userId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.userId));

  async function add(targets: Array<{ userId: string } | { email: string }>) {
    setBusy(true);
    setFeedback({});
    const failures: string[] = [];
    for (const target of targets) {
      try {
        await api('POST', `/teams/${team.id}/members`, { ...target, role: effectiveRole });
      } catch (caught) {
        const label = 'email' in target ? target.email : (items.find((item) => item.userId === target.userId)?.displayName ?? '');
        failures.push(`${label}: ${message(caught)}`);
      }
    }
    const added = targets.length - failures.length;
    setFeedback({
      ...(added ? { ok: `${added} pessoa(s) adicionada(s) como ${roleLabel[effectiveRole]}.` } : {}),
      ...(failures.length ? { error: failures.join(' · ') } : {}),
    });
    setBusy(false);
    setVersion((current) => current + 1);
    if (added) onChange();
    return failures.length === 0;
  }

  return (
    <>
      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome ou e-mail" />
        <Segmented
          label="Participação em equipes"
          value={assignment}
          options={[
            ['any', 'Todas'],
            ['unassigned', 'Sem equipe'],
            ['assigned', 'Já em outra equipe'],
          ]}
          onChange={setAssignment}
        />
        {isDirector && (
          <label className="inline">
            Adicionar como
            <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <option value="operator">Usuário</option>
              <option value="leader">Supervisor</option>
            </select>
          </label>
        )}
      </div>

      <div className="count">
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={items.length === 0}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.userId)))}
          />
          Selecionar todos os exibidos
        </label>
        <button
          className="primary small"
          disabled={selected.size === 0 || busy}
          onClick={() => void add([...selected].map((userId) => ({ userId })))}
        >
          {busy ? 'Adicionando…' : `Adicionar selecionados (${selected.size})`}
        </button>
      </div>

      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      {feedback.error && feedback.ok && <Feedback ok={feedback.ok} />}

      <ul className="list compact team-candidates">
        {items.map((item) => (
          <li key={item.userId} className={selected.has(item.userId) ? 'picked' : ''}>
            <label className="check grow">
              <input type="checkbox" checked={selected.has(item.userId)} onChange={() => toggle(item.userId)} />
              <span className="who">
                <strong>{item.displayName}</strong>
                <span className="muted">
                  {item.email} ·{' '}
                  {item.teams
                    ? item.teams.length
                      ? item.teams.join(', ')
                      : 'sem equipe'
                    : item.teamCount
                      ? `${item.teamCount} equipe(s)`
                      : 'sem equipe'}
                </span>
              </span>
            </label>
            <button className="small" disabled={busy} onClick={() => void add([{ userId: item.userId }])}>
              Adicionar
            </button>
          </li>
        ))}
      </ul>
      {!loading && items.length === 0 && (
        <p className="empty">
          {query || assignment !== 'any' ? 'Ninguém corresponde aos filtros.' : 'Todas as pessoas ativas já estão na equipe.'}
        </p>
      )}
      {loading && (
        <p className="muted">
          <LoadingHint />
        </p>
      )}
      {cursor && !loading && (
        <button className="ghost" onClick={() => void load(cursor)}>
          Carregar mais
        </button>
      )}

      <details className="by-email">
        <summary>Adicionar por e-mail exato (casos específicos)</summary>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void add([{ email }]).then((ok) => ok && setEmail(''));
          }}
        >
          <input type="email" placeholder="E-mail de usuário ativo" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="primary" disabled={busy}>
            Adicionar
          </button>
        </form>
      </details>
    </>
  );
}

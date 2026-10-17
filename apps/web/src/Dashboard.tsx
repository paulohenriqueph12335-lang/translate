import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  api,
  ApiError,
  roleLabel,
  statusLabel,
  type AuditEvent,
  type Me,
  type Page,
  type Session,
  type Team,
  type TeamMember,
  type TeamRole,
  type User,
  type UserStatus,
  setUnauthorizedHandler,
} from './api';

type View = 'teams' | 'approvals' | 'users' | 'audit' | 'sessions';

const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Falha inesperada');

/** Carrega dados e expõe recarga; erros viram mensagem exibível. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load()
      .then(setData)
      .catch((caught: unknown) => setError(message(caught)));
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Feedback({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <div className="alert error" role="alert">
        {error}
      </div>
    );
  if (ok)
    return (
      <div className="alert success" role="status">
        {ok}
      </div>
    );
  return null;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

export function Dashboard({ me, onLogout, onUnauthorized }: { me: Me; onLogout: () => void; onUnauthorized: () => void }) {
  const isDirector = me.user.orgRole === 'director';
  const [view, setView] = useState<View>(isDirector ? 'approvals' : 'teams');
  const leads = me.memberships.filter((m) => m.role === 'leader').length;
  const role = isDirector ? 'Diretor' : leads ? 'Líder' : me.memberships.length ? 'Operador' : 'Sem equipe';

  // Sessão revogada/expirada em qualquer chamada leva de volta ao login.
  useEffect(() => setUnauthorizedHandler(onUnauthorized), [onUnauthorized]);

  const nav: Array<[View, string, boolean]> = [
    ['approvals', 'Aprovações', isDirector],
    ['users', 'Usuários', isDirector],
    ['teams', 'Equipes', true],
    ['audit', 'Auditoria', isDirector],
    ['sessions', 'Minhas sessões', true],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="eyebrow">PLATAFORMA DOCUMENTAL</span>
        <div className="identity">
          <strong>{me.user.displayName}</strong>
          <span className="muted">{me.user.email}</span>
          <span className="badge">{role}</span>
        </div>
        <nav>
          {nav
            .filter(([, , visible]) => visible)
            .map(([key, label]) => (
              <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
                {label}
              </button>
            ))}
        </nav>
        <button className="ghost" onClick={onLogout}>
          Sair
        </button>
      </aside>
      <main className="content">
        {view === 'approvals' && <Approvals />}
        {view === 'users' && <Users selfId={me.user.id} />}
        {view === 'teams' && <Teams isDirector={isDirector} selfId={me.user.id} />}
        {view === 'audit' && <Audit />}
        {view === 'sessions' && <Sessions />}
      </main>
    </div>
  );
}

function Approvals() {
  const { data, error, reload } = useLoad(() => api<Page<User>>('GET', '/users?status=pending&limit=100'), []);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

  async function act(user: User, action: 'approve' | 'reject') {
    try {
      await api('POST', `/users/${user.id}/${action}`);
      setFeedback({ ok: `Cadastro de ${user.displayName} ${action === 'approve' ? 'aprovado' : 'rejeitado'}.` });
      reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Aprovações pendentes" subtitle="Cadastros públicos não acessam nada até serem aprovados.">
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      {data && data.items.length === 0 && <p className="empty">Nenhum cadastro aguardando aprovação.</p>}
      <ul className="list">
        {data?.items.map((user) => (
          <li key={user.id}>
            <div>
              <strong>{user.displayName}</strong>
              <span className="muted">
                {user.email} · {dateTime(user.createdAt)}
              </span>
            </div>
            <div className="actions">
              <button className="primary small" onClick={() => act(user, 'approve')}>
                Aprovar
              </button>
              <button className="danger small" onClick={() => act(user, 'reject')}>
                Rejeitar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Users({ selfId }: { selfId: string }) {
  const [status, setStatus] = useState<UserStatus | ''>('active');
  const { data, error, reload } = useLoad(() => api<Page<User>>('GET', `/users?limit=100${status ? `&status=${status}` : ''}`), [status]);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

  async function run(label: string, call: () => Promise<unknown>) {
    try {
      await call();
      setFeedback({ ok: label });
      reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Usuários" subtitle="Suspender revoga todas as sessões imediatamente.">
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus | '')}>
          <option value="">Todos</option>
          {(Object.keys(statusLabel) as UserStatus[]).map((key) => (
            <option key={key} value={key}>
              {statusLabel[key]}
            </option>
          ))}
        </select>
      </div>
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <ul className="list">
        {data?.items.map((user) => {
          const self = user.id === selfId;
          return (
            <li key={user.id}>
              <div>
                <strong>
                  {user.displayName} {user.orgRole === 'director' && <span className="badge">Diretor</span>}{' '}
                  {self && <span className="badge soft">Você</span>}
                </strong>
                <span className="muted">
                  {user.email} · {statusLabel[user.status]}
                </span>
              </div>
              {!self && (
                <div className="actions">
                  {user.status === 'active' && (
                    <>
                      <button
                        className="small"
                        onClick={() =>
                          run('Papel atualizado.', () =>
                            api('PUT', `/users/${user.id}/org-role`, { orgRole: user.orgRole === 'director' ? 'member' : 'director' }),
                          )
                        }
                      >
                        {user.orgRole === 'director' ? 'Remover Diretor' : 'Tornar Diretor'}
                      </button>
                      <button
                        className="small"
                        onClick={() => run('Sessões revogadas.', () => api('POST', `/users/${user.id}/sessions/revoke`))}
                      >
                        Revogar sessões
                      </button>
                      <button
                        className="danger small"
                        onClick={() => run('Usuário suspenso.', () => api('POST', `/users/${user.id}/suspend`))}
                      >
                        Suspender
                      </button>
                    </>
                  )}
                  {user.status === 'suspended' && (
                    <button
                      className="primary small"
                      onClick={() => run('Usuário reativado.', () => api('POST', `/users/${user.id}/reactivate`))}
                    >
                      Reativar
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Teams({ isDirector, selfId }: { isDirector: boolean; selfId: string }) {
  const { data, error, reload } = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const team = data?.items.find((item) => item.id === selected) ?? null;

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

  return (
    <Section title="Equipes" subtitle={isDirector ? 'Você administra todas as equipes.' : 'Equipes das quais você participa.'}>
      {isDirector && (
        <form className="toolbar" onSubmit={create}>
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
      <div className="split">
        <ul className="list selectable">
          {data?.items.map((item) => (
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
        {team && <TeamDetail key={team.id} team={team} isDirector={isDirector} selfId={selfId} onChange={reload} />}
      </div>
    </Section>
  );
}

function TeamDetail({ team, isDirector, selfId, onChange }: { team: Team; isDirector: boolean; selfId: string; onChange: () => void }) {
  const canManage = isDirector || team.myRole === 'leader';
  const { data, error, reload } = useLoad(
    () => (canManage ? api<{ items: TeamMember[] }>('GET', `/teams/${team.id}/members`) : Promise.resolve({ items: [] })),
    [team.id, canManage],
  );
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('operator');
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

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

  if (!canManage) {
    return (
      <div className="card detail">
        <h3>{team.name}</h3>
        <p className="muted">Você participa como Operador. A gestão de membros cabe ao Líder da equipe.</p>
      </div>
    );
  }

  return (
    <div className="card detail">
      <h3>{team.name}</h3>
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void run('Membro adicionado.', async () => {
            await api('POST', `/teams/${team.id}/members`, { email, role: isDirector ? role : 'operator' });
            setEmail('');
          });
        }}
      >
        <input type="email" placeholder="E-mail de usuário ativo" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {isDirector && (
          <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
            <option value="operator">Operador</option>
            <option value="leader">Líder</option>
          </select>
        )}
        <button className="primary">Adicionar</button>
      </form>
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <ul className="list compact">
        {data?.items.map((member) => {
          const removable = isDirector || (member.role === 'operator' && member.userId !== selfId);
          return (
            <li key={member.userId}>
              <div>
                <strong>{member.displayName}</strong>
                <span className="muted">
                  {member.email} · {roleLabel[member.role]}
                  {member.status !== 'active' ? ` · ${statusLabel[member.status]}` : ''}
                </span>
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
                    {member.role === 'leader' ? 'Tornar Operador' : 'Tornar Líder'}
                  </button>
                )}
                {removable && (
                  <button
                    className="danger small"
                    onClick={() => run('Membro removido.', () => api('DELETE', `/teams/${team.id}/members/${member.userId}`))}
                  >
                    Remover
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Audit() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string | null) => {
    try {
      const page = await api<Page<AuditEvent>>('GET', `/audit-events?limit=50${from ? `&cursor=${encodeURIComponent(from)}` : ''}`);
      setEvents((current) => (from ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(message(caught));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <Section title="Auditoria" subtitle="Registro somente inserção de ações de acesso e administração.">
      <Feedback error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Ação</th>
              <th>Alvo</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{dateTime(event.occurredAt)}</td>
                <td>{event.actor?.displayName ?? '—'}</td>
                <td>
                  <code>{event.action}</code>
                </td>
                <td className="muted">{event.targetType ? `${event.targetType} ${event.targetId?.slice(0, 8) ?? ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button className="ghost" onClick={() => void load(cursor)}>
          Carregar mais
        </button>
      )}
    </Section>
  );
}

function Sessions() {
  const { data, error, reload } = useLoad(() => api<{ items: Session[] }>('GET', '/auth/sessions'), []);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function revoke(session: Session) {
    try {
      await api('DELETE', `/auth/sessions/${session.id}`);
      if (session.current) window.location.reload();
      else reload();
    } catch (caught) {
      setFeedback(message(caught));
    }
  }

  return (
    <Section title="Minhas sessões" subtitle="Encerre acessos de outros dispositivos a qualquer momento.">
      <Feedback error={error ?? feedback} />
      <ul className="list">
        {data?.items.map((session) => (
          <li key={session.id}>
            <div>
              <strong>
                {session.userAgent?.slice(0, 80) ?? 'Navegador desconhecido'}{' '}
                {session.current && <span className="badge soft">Esta sessão</span>}
              </strong>
              <span className="muted">
                Início {dateTime(session.createdAt)} · último uso {dateTime(session.lastSeenAt)} · expira {dateTime(session.expiresAt)}
              </span>
            </div>
            <button className="danger small" onClick={() => revoke(session)}>
              Encerrar
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

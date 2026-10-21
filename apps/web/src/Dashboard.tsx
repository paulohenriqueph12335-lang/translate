import { useEffect, useState } from 'react';
import { api, statusLabel, type Me, type Page, type Session, type User, type UserStatus, setUnauthorizedHandler } from './api';
import { Audit } from './Audit';
import { AutoTranslationNotice } from './AutoTranslationNotice';
import { Documents } from './Documents';
import { Downloads } from './Downloads';
import { Notifications, useUnreadCount } from './Notifications';
import { Numbering } from './Numbering';
import { OrganizationPanel, TeamPanel } from './Panels';
import { History, Workspace } from './Workspace';
import { TranslationRulesEditor } from './Modes';
import { Patterns } from './Patterns';
import { Glossary, TranslationSettingsView } from './TranslationAdmin';
import { Translations } from './Translations';
import { Teams } from './Teams';
import { Translators } from './Translators';
import { dateTime, Feedback, message, Section, useLoad } from './ui';

type View =
  | 'panel'
  | 'teamPanel'
  | 'workspace'
  | 'history'
  | 'numbering'
  | 'translators'
  | 'translations'
  | 'documents'
  | 'downloads'
  | 'notifications'
  | 'glossary'
  | 'rules'
  | 'patterns'
  | 'teams'
  | 'approvals'
  | 'users'
  | 'settings'
  | 'audit'
  | 'sessions';

export function Dashboard({ me, onLogout, onUnauthorized }: { me: Me; onLogout: () => void; onUnauthorized: () => void }) {
  const isDirector = me.user.orgRole === 'director';
  const supervises = me.memberships.some((m) => m.role === 'leader');
  // Tela inicial de cada papel (plano de hierarquia): Diretor → painel; Supervisor → painel da equipe; Usuário → workspace.
  const [view, setView] = useState<View>(isDirector ? 'panel' : supervises ? 'teamPanel' : 'workspace');
  const [panelTeam, setPanelTeam] = useState<string | null>(null);
  const [openTranslation, setOpenTranslation] = useState<string | null>(null);
  const [notificationsVersion, setNotificationsVersion] = useState(0);
  const unread = useUnreadCount(notificationsVersion);
  const pending = useLoad(
    () => (isDirector ? api<Page<User>>('GET', '/users?status=pending&limit=100') : Promise.resolve(null)),
    [isDirector, view],
  );
  const goToTranslation = (id: string) => {
    setOpenTranslation(id);
    setView('translations');
  };
  const go = (next: View) => {
    if (next === 'translations') setOpenTranslation(null);
    setView(next);
  };
  const leads = me.memberships.filter((m) => m.role === 'leader').length;
  const role = isDirector ? 'Diretor' : leads ? 'Supervisor' : me.memberships.length ? 'Usuário' : 'Sem equipe';

  // Sessão revogada/expirada em qualquer chamada leva de volta ao login.
  useEffect(() => setUnauthorizedHandler(onUnauthorized), [onUnauthorized]);

  const pendingCount = pending.data?.items.length ?? 0;
  const nav: Array<{ key: View; label: string; visible: boolean; count?: number; group?: string }> = [
    { key: 'panel', label: 'Painel', visible: isDirector },
    { key: 'teamPanel', label: isDirector ? 'Painel das equipes' : 'Painel da equipe', visible: isDirector || supervises },
    { key: 'workspace', label: 'Meu workspace', visible: true },
    { key: 'translations', label: 'Traduções', visible: true },
    { key: 'documents', label: 'Envios', visible: true },
    { key: 'history', label: 'Histórico', visible: true },
    { key: 'downloads', label: 'Downloads', visible: true },
    { key: 'notifications', label: 'Notificações', visible: true, count: unread },
    { key: 'numbering', label: 'Numeração', visible: true, group: 'Controle' },
    { key: 'translators', label: 'Tradutores juramentados', visible: isDirector || supervises },
    { key: 'audit', label: 'Auditoria', visible: isDirector || supervises },
    { key: 'glossary', label: 'Glossário', visible: true },
    { key: 'rules', label: 'Regras de tradução', visible: true },
    { key: 'patterns', label: 'Padrões de documento', visible: true },
    { key: 'teams', label: 'Equipes', visible: true },
    { key: 'approvals', label: 'Cadastros pendentes', visible: isDirector, count: pendingCount, group: 'Administração' },
    { key: 'users', label: 'Usuários', visible: isDirector },
    { key: 'settings', label: 'Configurações', visible: isDirector },
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
            .filter((item) => item.visible)
            .map((item) => (
              <div key={item.key} className="nav-item">
                {item.group && <span className="nav-group">{item.group}</span>}
                <button className={view === item.key ? 'active' : ''} onClick={() => go(item.key)}>
                  {item.label}
                  {!!item.count && <span className="nav-count">{item.count}</span>}
                </button>
              </div>
            ))}
        </nav>
        <div className="sidebar-foot">
          <button className={`ghost small ${view === 'sessions' ? 'active' : ''}`} onClick={() => go('sessions')}>
            Minhas sessões
          </button>
          <button className="ghost" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="content">
        {(view === 'translations' || view === 'documents') && !openTranslation && (
          <AutoTranslationNotice isDirector={isDirector} canManageTranslators={supervises} onGoTranslators={() => go('translators')} />
        )}
        {view === 'panel' && (
          <OrganizationPanel
            onOpenTeam={(teamId) => {
              setPanelTeam(teamId);
              go('teamPanel');
            }}
          />
        )}
        {view === 'teamPanel' && <TeamPanel key={panelTeam ?? 'default'} me={me} initialTeamId={panelTeam} />}
        {view === 'workspace' && (
          <Workspace onOpenTranslation={goToTranslation} onUpload={() => go('documents')} onNotifications={() => go('notifications')} />
        )}
        {view === 'history' && <History onOpenTranslation={goToTranslation} />}
        {view === 'numbering' && <Numbering me={me} onOpenTranslation={goToTranslation} />}
        {view === 'translators' && <Translators canManage={supervises} />}
        {view === 'translations' && (
          <Translations me={me} openId={openTranslation} onOpen={setOpenTranslation} onGoTranslators={() => go('translators')} />
        )}
        {view === 'documents' && <Documents me={me} onOpenTranslation={goToTranslation} />}
        {view === 'downloads' && <Downloads me={me} onOpenTranslation={goToTranslation} />}
        {view === 'notifications' && (
          <Notifications
            onOpenTranslation={goToTranslation}
            onOpenDocuments={() => go('documents')}
            onChange={() => setNotificationsVersion((current) => current + 1)}
          />
        )}
        {view === 'glossary' && <Glossary me={me} />}
        {view === 'patterns' && <Patterns />}
        {view === 'rules' && (
          <Section title="Regras de tradução" subtitle="Etapas e regras de cada modalidade, por idioma de destino.">
            <TranslationRulesEditor />
          </Section>
        )}
        {view === 'teams' && <Teams isDirector={isDirector} selfId={me.user.id} />}
        {view === 'approvals' && <Approvals onChange={pending.reload} />}
        {view === 'users' && <Users selfId={me.user.id} />}
        {view === 'settings' && <TranslationSettingsView />}
        {view === 'audit' && <Audit me={me} />}
        {view === 'sessions' && <Sessions />}
      </main>
    </div>
  );
}

function Approvals({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useLoad(() => api<Page<User>>('GET', '/users?status=pending&limit=100'), []);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

  async function act(user: User, action: 'approve' | 'reject') {
    try {
      await api('POST', `/users/${user.id}/${action}`);
      setFeedback({ ok: `Cadastro de ${user.displayName} ${action === 'approve' ? 'aprovado' : 'rejeitado'}.` });
      reload();
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Cadastros pendentes" subtitle="Cadastros públicos não acessam nada até serem aprovados.">
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
                        onClick={() => {
                          const promote = user.orgRole !== 'director';
                          // Diretor não ocupa cargo de equipe: a promoção remove as associações (ADR-005).
                          if (
                            promote &&
                            !window.confirm(
                              `Tornar ${user.displayName} Diretor(a)? A pessoa sairá de todas as equipes em que é Supervisor ou Usuário.`,
                            )
                          )
                            return;
                          void run(
                            promote ? 'Promovido(a) a Diretor(a); associações de equipe removidas.' : 'Papel de Diretor removido.',
                            () => api('PUT', `/users/${user.id}/org-role`, { orgRole: promote ? 'director' : 'member' }),
                          );
                        }}
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

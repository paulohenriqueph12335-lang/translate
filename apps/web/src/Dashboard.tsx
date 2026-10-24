import { useEffect, useState, type ReactNode } from 'react';
import { AiComparisonPanel } from './AiComparison';
import { AiManagement } from './AiManagement';
import { api, statusLabel, type Me, type Page, type Session, type User, type UserStatus, setUnauthorizedHandler } from './api';
import { Audit } from './Audit';
import { AutoTranslationNotice } from './AutoTranslationNotice';
import { Documents } from './Documents';
import { Downloads } from './Downloads';
import { LiveNotifications } from './LiveNotifications';
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
import { Settings, PasswordSettings } from './Settings';
import { useUserPreferences } from './preferences';
import { SmartSearch, type DocumentsSearchTarget } from './SmartSearch';
import { PerformancePanel } from './PerformancePanel';
import { dateTime, EmbeddedSection, Wordmark, Feedback, message, Section, useLoad } from './ui';

/**
 * Navegação por papel, compacta: poucas áreas no menu e as telas parecidas como abas dentro delas.
 * Usuário: traduzir e o próprio histórico. Líder: início, traduções, equipe e ajustes. Diretor: o mesmo, mais a
 * administração da organização.
 */
type AreaKey = 'home' | 'work' | 'history' | 'team' | 'settings' | 'admin' | 'notifications' | 'account';

interface Tab {
  key: string;
  label: string;
  count?: number;
  render: () => ReactNode;
}

interface Area {
  key: AreaKey;
  label: string;
  /** Rótulo da barra de baixo no celular, quando o nome inteiro não cabe. */
  short?: string;
  title: string;
  subtitle: string;
  count?: number;
  tabs: Tab[];
}

export function Dashboard({ me, onLogout, onUnauthorized }: { me: Me; onLogout: () => void; onUnauthorized: () => void }) {
  const isDirector = me.user.orgRole === 'director';
  const supervises = me.memberships.some((m) => m.role === 'leader');
  const manages = isDirector || supervises;
  // Todos os perfis têm início; as métricas pessoais são filtradas também na API.
  const [place, setPlace] = useState<{ area: AreaKey; tab: string }>({ area: 'home', tab: '' });
  const [auditSearch, setAuditSearch] = useState('');
  const [documentTarget, setDocumentTarget] = useState<DocumentsSearchTarget>({});
  const [reportSearch, setReportSearch] = useState('');
  const [panelTeam, setPanelTeam] = useState<string | null>(null);
  const [openTranslation, setOpenTranslation] = useState<string | null>(null);
  const [notificationsVersion, setNotificationsVersion] = useState(0);
  const unread = useUnreadCount(notificationsVersion);
  const preferences = useUserPreferences(me.user.id);
  const pending = useLoad(
    () => (isDirector ? api<Page<User>>('GET', '/users?status=pending&limit=100') : Promise.resolve(null)),
    [isDirector, place.area],
  );
  const go = (area: AreaKey, tab = '') => {
    setOpenTranslation(null);
    setPlace({ area, tab });
  };
  const goToTranslation = (id: string) => {
    setOpenTranslation(id);
    setPlace({ area: 'work', tab: manages ? 'team' : 'mine' });
  };
  const goToUpload = () => go('work', 'send');
  const goToTranslators = () => (manages ? go('team', 'translators') : undefined);
  const leads = me.memberships.filter((m) => m.role === 'leader').length;
  const role = isDirector ? 'Diretor' : leads ? 'Supervisor' : me.memberships.length ? 'Usuário' : 'Sem equipe';

  // Sessão revogada/expirada em qualquer chamada leva de volta ao login.
  useEffect(() => setUnauthorizedHandler(onUnauthorized), [onUnauthorized]);

  const pendingCount = pending.data?.items.length ?? 0;
  const translationNotice = (
    <AutoTranslationNotice isDirector={isDirector} canManageTranslators={supervises} onGoTranslators={() => goToTranslators()} />
  );
  const translations = () => (
    <>
      {!openTranslation && translationNotice}
      <Translations me={me} openId={openTranslation} onOpen={setOpenTranslation} onGoTranslators={() => goToTranslators()} />
    </>
  );
  const workspace = () =>
    openTranslation ? (
      translations()
    ) : (
      <Workspace me={me} onOpenTranslation={goToTranslation} onUpload={goToUpload} onNotifications={() => go('notifications')} />
    );
  const send = () => (
    <>
      {translationNotice}
      <Documents
        me={me}
        initialSearch={documentTarget.q ?? ''}
        initialBatchId={documentTarget.batchId ?? null}
        onOpenTranslation={goToTranslation}
      />
    </>
  );

  const areas: Area[] = [
    {
      key: 'home',
      label: 'Início',
      title: 'Início',
      subtitle: isDirector
        ? 'Como a organização e cada equipe estão indo.'
        : manages
          ? 'Como a sua equipe está indo.'
          : 'Seu desenvolvimento e as suas entregas.',
      tabs: [
        ...(!manages
          ? [
              {
                key: 'mine',
                label: 'Meu início',
                render: () => <PerformancePanel me={me} personal onOpenTranslation={goToTranslation} />,
              },
            ]
          : []),
        ...(isDirector
          ? [
              {
                key: 'organization',
                label: 'Organização',
                render: () => (
                  <OrganizationPanel
                    me={me}
                    initialSearch={reportSearch}
                    onOpenTeam={(teamId) => {
                      setPanelTeam(teamId);
                      setPlace({ area: 'home', tab: 'teams' });
                    }}
                  />
                ),
              },
              { key: 'quality', label: 'Erros × acertos', render: () => <PerformancePanel me={me} onOpenTranslation={goToTranslation} /> },
            ]
          : []),
        ...(manages
          ? [
              {
                key: 'teams',
                label: isDirector ? 'Equipes' : 'Equipe',
                render: () => <TeamPanel key={panelTeam ?? 'default'} me={me} initialTeamId={panelTeam} initialSearch={reportSearch} />,
              },
              { key: 'ai', label: 'Com IA × sem IA', render: () => <AiComparisonPanel me={me} /> },
              {
                key: 'personal',
                label: 'Meu desenvolvimento',
                render: () => <PerformancePanel me={me} personal onOpenTranslation={goToTranslation} />,
              },
            ]
          : []),
      ],
    },
    {
      key: 'work',
      label: manages ? 'Traduções' : 'Traduzir',
      title: manages ? 'Traduções' : 'Traduzir',
      subtitle: manages
        ? 'O seu trabalho, o da equipe, os envios e o que já foi concluído.'
        : 'Envie documentos, revise o que está com você e assuma o que a equipe deixou disponível.',
      tabs: [
        { key: 'mine', label: 'Meu trabalho', render: workspace },
        ...(manages ? [{ key: 'team', label: isDirector ? 'Todas as traduções' : 'Da equipe', render: translations }] : []),
        { key: 'send', label: 'Nova tradução', render: send },
        { key: 'done', label: 'Entregas e ZIP', render: () => <Downloads me={me} onOpenTranslation={goToTranslation} /> },
      ],
    },
    {
      key: 'history',
      label: 'Meu histórico',
      title: 'Meu histórico',
      subtitle: 'O que você já finalizou, com o número da tradução e o arquivo final.',
      tabs: [{ key: 'history', label: 'Histórico', render: () => <History onOpenTranslation={goToTranslation} /> }],
    },
    {
      key: 'team',
      label: isDirector ? 'Equipes' : 'Equipe',
      title: isDirector ? 'Equipes' : 'Equipe',
      subtitle: 'Pessoas, numeração, tradutores juramentados e o registro do que foi feito.',
      tabs: [
        { key: 'people', label: 'Pessoas', render: () => <Teams isDirector={isDirector} selfId={me.user.id} /> },
        { key: 'numbering', label: 'Numeração', render: () => <Numbering me={me} onOpenTranslation={goToTranslation} /> },
        { key: 'translators', label: 'Tradutores juramentados', render: () => <Translators canManage={supervises} /> },
        {
          key: 'audit',
          label: 'Auditoria',
          render: () => <Audit key={auditSearch} me={me} initialSearch={auditSearch} onOpenTranslation={goToTranslation} />,
        },
      ],
    },
    {
      key: 'settings',
      label: 'Ajustes',
      title: 'Ajustes da tradução',
      subtitle: 'Como o sistema traduz: termos, regras, tipos de documento e a IA.',
      tabs: [
        { key: 'glossary', label: 'Glossário', render: () => <Glossary me={me} /> },
        {
          key: 'rules',
          label: 'Regras',
          render: () => (
            <Section title="Regras de tradução" subtitle="Etapas e regras de cada modalidade, por idioma de destino.">
              <TranslationRulesEditor />
            </Section>
          ),
        },
        { key: 'patterns', label: 'Tipos de documento', render: () => <Patterns /> },
        { key: 'ai', label: 'IA', render: () => <AiManagement /> },
        ...(isDirector ? [{ key: 'machine', label: 'Tradução automática', render: () => <TranslationSettingsView /> }] : []),
      ],
    },
    {
      key: 'admin',
      label: 'Administração',
      short: 'Admin.',
      title: 'Administração',
      subtitle: 'Quem entra no sistema e com que papel.',
      count: pendingCount,
      tabs: [
        { key: 'approvals', label: 'Cadastros pendentes', count: pendingCount, render: () => <Approvals onChange={pending.reload} /> },
        { key: 'users', label: 'Usuários', render: () => <Users selfId={me.user.id} /> },
      ],
    },
  ];
  // Configurações pessoais e notificações estão ao alcance de todos os perfis.
  const menu: AreaKey[] = isDirector
    ? ['home', 'work', 'team', 'settings', 'admin']
    : supervises
      ? ['home', 'work', 'team', 'settings']
      : ['home', 'work', 'history'];
  const footer: Area[] = [
    {
      key: 'notifications',
      label: 'Notificações',
      title: 'Notificações',
      subtitle: '',
      count: unread,
      tabs: [
        {
          key: 'notifications',
          label: 'Notificações',
          render: () => (
            <Notifications
              onOpenTranslation={goToTranslation}
              onOpenDocuments={(batchId) => {
                setDocumentTarget(batchId ? { batchId } : {});
                goToUpload();
              }}
              onChange={() => setNotificationsVersion((current) => current + 1)}
            />
          ),
        },
      ],
    },
    {
      key: 'account',
      label: 'Configurações',
      title: 'Configurações',
      subtitle: 'Preferências e segurança da sua conta.',
      tabs: [
        {
          key: 'preferences',
          label: 'Preferências',
          render: () => (
            <Settings
              preferences={preferences.data}
              loading={preferences.loading}
              saving={preferences.saving}
              error={preferences.error}
              onReload={preferences.reload}
              onSave={preferences.update}
            />
          ),
        },
        { key: 'password', label: 'Alterar senha', render: () => <PasswordSettings email={me.user.email} /> },
        { key: 'sessions', label: 'Minhas sessões', render: () => <Sessions /> },
      ],
    },
  ];
  const visible = areas.filter((area) => menu.includes(area.key));
  const current = [...visible, ...footer].find((area) => area.key === place.area) ?? visible[0]!;
  const tab = current.tabs.find((item) => item.key === place.tab) ?? current.tabs[0]!;
  // Áreas de uma aba só mostram a tela como sempre; com várias, o título da área e as abas.
  const single = current.tabs.length === 1;
  const navigationGroup = (key: AreaKey) => (key === 'home' ? 'Visão geral' : key === 'work' || key === 'history' ? 'Operação' : 'Gestão');

  return (
    <div className="shell">
      <aside className="sidebar">
        <Wordmark />
        <div className="identity">
          <strong>{me.user.displayName}</strong>
          <span className="muted">{me.user.email}</span>
          <span className="badge">{role}</span>
        </div>
        <nav aria-label="Navegação principal">
          {visible.map((area, index) => (
            <div key={area.key} className="nav-item">
              {(index === 0 || navigationGroup(visible[index - 1]!.key) !== navigationGroup(area.key)) && (
                <span className="nav-group">{navigationGroup(area.key)}</span>
              )}
              <button aria-label={area.label} className={current.key === area.key ? 'active' : ''} onClick={() => go(area.key)}>
                <span className="label-full">{area.label}</span>
                <span className="label-short">{area.short ?? area.label}</span>
                {!!area.count && <span className="nav-count">{area.count}</span>}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="nav-group account-nav-label">Minha conta</span>
          {footer.map((area) => (
            <button
              key={area.key}
              className={`ghost small foot-${area.key} ${current.key === area.key ? 'active' : ''}`}
              onClick={() => go(area.key)}
            >
              {area.label}
              {!!area.count && <span className="nav-count">{area.count}</span>}
            </button>
          ))}
          <button className="ghost foot-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="content">
        <LiveNotifications
          userId={me.user.id}
          onOpenTranslation={goToTranslation}
          onOpenNotifications={() => go('notifications')}
          onNew={() => setNotificationsVersion((value) => value + 1)}
        />
        {me.user.testAccount && <TestAccountBanner me={me} onDeleted={onLogout} />}
        {single ? (
          <div key={current.key} className="panel-enter">
            {tab.render()}
          </div>
        ) : (
          <section className="area">
            <header className="area-head">
              <h2>{current.title}</h2>
              <p className="muted">{current.subtitle}</p>
            </header>
            {current.key === 'home' && manages && (
              <SmartSearch
                me={me}
                onOpenTranslation={goToTranslation}
                onOpenAudit={(q) => {
                  setAuditSearch(q);
                  go('team', 'audit');
                }}
                onOpenDocuments={(target) => {
                  setDocumentTarget(target);
                  go('work', 'send');
                }}
                onOpenReports={(q) => {
                  setReportSearch(q);
                  go('home', 'teams');
                }}
                onOpenTeam={(teamId) => {
                  setPanelTeam(teamId);
                  go('home', 'teams');
                }}
              />
            )}
            <div className="tabs area-tabs" role="tablist" aria-label={current.title}>
              {current.tabs.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={item.key === tab.key}
                  className={item.key === tab.key ? 'on' : ''}
                  onClick={() => go(current.key, item.key)}
                >
                  {item.label}
                  {!!item.count && <span className="nav-count">{item.count}</span>}
                </button>
              ))}
            </div>
            <EmbeddedSection.Provider value={true}>
              {/* A troca de aba entra com um movimento curto; a chave remonta o painel a cada troca. */}
              <div role="tabpanel" key={`${current.key}:${tab.key}:${openTranslation ?? ''}`} className="panel-enter">
                {tab.render()}
              </div>
            </EmbeddedSection.Provider>
          </section>
        )}
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
                  {user.testAccount && <span className="badge warn">Conta de teste</span>}
                </strong>
                <span className="muted">
                  {user.email} · {statusLabel[user.status]}
                </span>
              </div>
              {!self && (
                <div className="actions">
                  {user.testAccount && (
                    <button
                      className="small"
                      onClick={() => {
                        if (!window.confirm(`Excluir a conta de teste de ${user.displayName}? Não dá para desfazer.`)) return;
                        void run('Conta de teste excluída.', () => api('POST', `/users/${user.id}/delete-test-account`));
                      }}
                    >
                      Excluir conta de teste
                    </button>
                  )}
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

/**
 * Conta de teste (ADR-004): lembra que é teste, mostra as contas de teste (para o Diretor) e exclui com um clique;
 * sem Diretor, volta a configuração inicial.
 */
function TestAccountBanner({ me, onDeleted }: { me: Me; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const director = me.user.orgRole === 'director';
  const accounts = useLoad(
    () =>
      director
        ? api<{ items: Array<{ id: string; name: string; email: string; role: string }> }>('GET', '/test-accounts')
        : Promise.resolve(null),
    [director],
  );
  const others = (accounts.data?.items ?? []).filter((item) => item.id !== me.user.id);
  async function remove() {
    const warning = director
      ? `Excluir ${others.length ? `todas as ${others.length + 1} contas de teste` : 'esta conta de teste'}? Você sai do sistema e, se não houver outro Diretor, volta a tela de configuração inicial para criar a conta definitiva.`
      : 'Excluir esta conta de teste? Você sai do sistema.';
    if (!window.confirm(warning)) return;
    try {
      await api('POST', director ? '/test-accounts/delete-all' : `/users/${me.user.id}/delete-test-account`);
      onDeleted();
    } catch (caught) {
      setError(message(caught));
    }
  }
  return (
    <div className="alert test-account" role="status">
      <span>
        <strong>Conta de teste.</strong> Use à vontade; quando terminar, exclua para criar a conta definitiva.
        {others.length > 0 && (
          <span className="block-line small-text">
            Outras contas de teste (mesma senha que a sua): {others.map((item) => `${item.role} – ${item.email}`).join(' · ')}
          </span>
        )}
      </span>
      <button className="small" onClick={() => void remove()}>
        {director && others.length ? 'Excluir contas de teste' : 'Excluir conta de teste'}
      </button>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

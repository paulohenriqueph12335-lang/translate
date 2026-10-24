import { TranslatorNumberingAdmin, TranslatorNumberingDashboard } from './TranslatorNumbering';
import { useState } from 'react';
import { api, requestStatusLabel, roleLabel, type Me, type NumberingOverview, type NumberingRequest } from './api';
import { Meter } from './Charts';
import { dateTime, Feedback, message, Section, Segmented, useLoad } from './ui';
import { useConfirm } from './ConfirmDialog';

/**
 * Numeração (plano de hierarquia): o Diretor define o total da organização e o teto das equipes; o Supervisor, a cota
 * anual de cada Usuário (1 a 1000); pedidos de alteração ou anulação são decididos aqui. Usuário vê a própria cota.
 */
export function Numbering({ me, onOpenTranslation }: { me: Me; onOpenTranslation: (id: string) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [version, setVersion] = useState(0);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const { data, error } = useLoad(() => api<NumberingOverview>('GET', `/numbering?year=${year}`), [year, version]);
  const isDirector = me.user.orgRole === 'director';
  const supervises = isDirector || me.memberships.some((m) => m.role === 'leader');
  // Supervisores e Diretor começam pelos tradutores (ADR-014); as cotas anuais seguem na outra aba.
  const [tab, setTab] = useState<'translators' | 'quotas'>(supervises ? 'translators' : 'quotas');
  const [managing, setManaging] = useState<string | null>(null);

  async function save(body: Record<string, unknown>, label: string) {
    try {
      await api('PUT', '/numbering/quotas', { year, ...body });
      setFeedback({ ok: label });
      setVersion((current) => current + 1);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section
      title="Numeração"
      subtitle={
        supervises
          ? 'Quantos números de Tradução Pública cada nível pode usar no ano. Sem cota, não há limite naquele nível.'
          : 'Sua cota de números de Tradução Pública no ano e seus pedidos de alteração.'
      }
    >
      {supervises && (
        <Segmented
          label="Numeração"
          value={tab}
          options={[
            ['translators', 'Tradutores e números'],
            ['quotas', 'Cotas e pedidos'],
          ]}
          onChange={(value) => {
            setTab(value);
            setManaging(null);
          }}
        />
      )}
      {tab === 'translators' && supervises && (
        <div className="top-gap">
          {managing ? (
            <TranslatorNumberingAdmin translatorId={managing} onBack={() => setManaging(null)} />
          ) : (
            <TranslatorNumberingDashboard onManage={me.memberships.some((m) => m.role === 'leader') ? setManaging : undefined} />
          )}
        </div>
      )}
      {tab === 'quotas' && (
        <>
          <div className="filters">
            <select aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
          {data && (
            <>
              <div className="card quota-mine">
                <strong>Minha cota em {data.year}</strong>
                <Meter used={data.mine.used} quota={data.mine.quota} />
              </div>

              {data.organization && (
                <>
                  <h3 className="top-gap">Organização e equipes</h3>
                  <ul className="list compact">
                    <li>
                      <div>
                        <strong>Toda a organização</strong>
                        <Meter used={data.organization.used} quota={data.organization.quota} />
                      </div>
                      <QuotaEditor
                        value={data.organization.quota}
                        max={1_000_000}
                        onSave={(quota) => save({ scope: 'organization', quota }, 'Limite da organização salvo.')}
                      />
                    </li>
                    {data.teams.map((team) => (
                      <li key={team.id}>
                        <div>
                          <strong>{team.name}</strong>
                          <Meter used={team.used} quota={team.quota} />
                        </div>
                        {team.canEdit && (
                          <QuotaEditor
                            value={team.quota}
                            max={1_000_000}
                            onSave={(quota) => save({ scope: 'team', teamId: team.id, quota }, `Limite da equipe ${team.name} salvo.`)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {supervises && data.users.length > 0 && (
                <>
                  <h3 className="top-gap">Cota por pessoa</h3>
                  <p className="muted small-text">
                    De 1 a 1000 números no ano. Ao chegar a 80% e a 100%, o Supervisor é avisado; com 100%, novas conclusões ficam
                    bloqueadas.
                  </p>
                  <ul className="list compact">
                    {data.users.map((user) => (
                      <li key={user.id}>
                        <div>
                          <strong>{user.name}</strong>
                          <span className="muted">{user.teams.map((team) => `${team.name} (${roleLabel[team.role]})`).join(' · ')}</span>
                          <Meter used={user.used} quota={user.quota} />
                        </div>
                        {user.canEdit && (
                          <QuotaEditor
                            value={user.quota}
                            max={1000}
                            onSave={(quota) => save({ scope: 'user', userId: user.id, quota }, `Cota de ${user.name} salva.`)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <Requests onOpenTranslation={onOpenTranslation} onChange={() => setVersion((current) => current + 1)} />
        </>
      )}
    </Section>
  );
}

function QuotaEditor({ value, max, onSave }: { value: number | null; max: number; onSave: (quota: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const parsed = draft.trim() === '' ? null : Number(draft);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > max);
  return (
    <form
      className="quota-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) onSave(parsed);
      }}
    >
      <input
        type="number"
        min={1}
        max={max}
        inputMode="numeric"
        placeholder="sem limite"
        aria-label="Cota"
        aria-invalid={invalid}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="small" disabled={invalid || parsed === value}>
        Salvar
      </button>
      {invalid && <span className="error-text small-text">De 1 a {max.toLocaleString('pt-BR')}</span>}
    </form>
  );
}

function Requests({ onOpenTranslation, onChange }: { onOpenTranslation: (id: string) => void; onChange: () => void }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(
    () => api<{ items: NumberingRequest[] }>('GET', `/numbering-requests${status === 'pending' ? '?status=pending' : ''}`),
    [status, version],
  );
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

  async function act(label: string, call: () => Promise<unknown>) {
    try {
      await call();
      setFeedback({ ok: label });
      setVersion((current) => current + 1);
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  const describe = (request: NumberingRequest) =>
    request.kind === 'annul'
      ? `Anular o nº ${request.current.number}`
      : `Alterar o nº ${request.current.number}: ${[
          request.requested.number ? `número ${request.requested.number}` : null,
          request.requested.book ? `livro ${request.requested.book}` : null,
          request.requested.sheet ? `folha ${request.requested.sheet}` : null,
        ]
          .filter(Boolean)
          .join(', ')}`;

  return (
    <>
      <h3 className="top-gap">Pedidos de alteração e anulação</h3>
      <Segmented
        label="Pedidos"
        value={status}
        options={[
          ['pending', 'Aguardando decisão'],
          ['all', 'Todos'],
        ]}
        onChange={setStatus}
      />
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <ul className="list">
        {data?.items.map((request) => (
          <li key={request.id}>
            <div>
              <strong>
                {describe(request)}{' '}
                <span className={`badge ${request.status === 'pending' ? 'warn' : request.status === 'approved' ? '' : 'soft'}`}>
                  {requestStatusLabel[request.status]}
                </span>
              </strong>
              <span>
                <button className="link" onClick={() => onOpenTranslation(request.translationId)}>
                  {request.document.name}
                </button>{' '}
                · {request.team?.name ?? 'sem equipe'} · pedido por {request.requestedBy} em {dateTime(request.createdAt)}
              </span>
              <span className="muted">Motivo: {request.reason}</span>
              {request.decidedBy && (
                <span className="muted small-text">
                  Decidido por {request.decidedBy} em {dateTime(request.decidedAt!)}
                  {request.decisionNote ? ` · ${request.decisionNote}` : ''}
                </span>
              )}
            </div>
            <div className="actions">
              {request.permissions.decide && (
                <>
                  <button
                    className="small primary"
                    onClick={async () =>
                      (await confirm(
                        'Tem certeza de que deseja alterar a numeração deste documento concluído? A nova versão e a decisão ficarão registradas na auditoria.',
                      )) && act('Pedido autorizado.', () => api('POST', `/numbering-requests/${request.id}/decide`, { approve: true }))
                    }
                  >
                    Autorizar
                  </button>
                  <button
                    className="small danger"
                    onClick={() => {
                      const note = window.prompt('Motivo da recusa (opcional):') ?? undefined;
                      void act('Pedido recusado.', () =>
                        api('POST', `/numbering-requests/${request.id}/decide`, { approve: false, ...(note ? { note } : {}) }),
                      );
                    }}
                  >
                    Recusar
                  </button>
                </>
              )}
              {request.permissions.revert && (
                <button
                  className="small"
                  onClick={async () =>
                    (await confirm('Desfazer esta decisão e voltar a numeração anterior?')) &&
                    void act('Decisão revertida.', () => api('POST', `/numbering-requests/${request.id}/revert`))
                  }
                >
                  Reverter
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data && data.items.length === 0 && (
        <p className="empty">{status === 'pending' ? 'Nenhum pedido aguardando decisão.' : 'Nenhum pedido ainda.'}</p>
      )}
    </>
  );
}

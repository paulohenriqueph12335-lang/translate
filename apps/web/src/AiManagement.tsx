import { useState } from 'react';
import {
  aiStatusLabel,
  api,
  type AiAccessItem,
  type AiCombination,
  type AiOutcomeStatus,
  type AiRequestItem,
  type AiSettings,
  type AiSkillItem,
  type AiStatus,
  type TranslationStatus,
} from './api';
import { dateTime, Feedback, message, Section, useLoad } from './ui';

const STATUS_TONE: Record<AiOutcomeStatus, string> = { ok: '', blocked: 'danger', denied: 'danger', failed: 'warn', unavailable: 'warn' };
const ALIGN_LABEL = { left: 'à esquerda', center: 'centralizado', right: 'à direita', justify: 'justificado' } as const;
const SIZE_LABEL = { normal: 'normal', small: 'menor', tiny: 'mínimo' } as const;

function AiStateBadge({ status }: { status: AiStatus }) {
  if (!status.configured) return <span className="badge warn">Sem chave GEMINI_API_KEY</span>;
  if (!status.enabled) return <span className="badge warn">Desligada</span>;
  return <span className="badge">Ligada · {status.model}</span>;
}

/**
 * Gerenciamento AI (ADR-021): o Gemini como gestor de processo e orientador técnico, sob as regras do sistema. Só
 * Líderes e o Diretor entram aqui; o Diretor liga e desliga, e cada Líder limita as pessoas das próprias equipes.
 */
export function AiManagement() {
  const settings = useLoad(() => api<AiSettings>('GET', '/ai/settings'), []);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const data = settings.data;

  async function save(label: string, call: () => Promise<unknown>) {
    setFeedback({});
    try {
      await call();
      setFeedback({ ok: label });
      settings.reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Gerenciamento AI" subtitle="Auxílio do Gemini com escopo restrito: glossário, diagramação aprovada na prévia e orientação do processo.">
      <Feedback error={feedback.error ?? settings.error ?? null} ok={feedback.ok ?? null} />
      {data && (
        <>
          <div className="card">
            <p>
              <AiStateBadge status={data} />
            </p>
            <p className="muted small-text">
              A IA nunca altera o texto nem a estrutura do documento: confere o glossário, sugere combinações de diagramação (que só valem
              depois de aprovadas na prévia) e orienta sobre o processo. Pedidos fora disso são barrados e ficam no registro abaixo. Se a IA
              parar, ficar sem cota ou estiver desligada, o sistema segue normalmente.
            </p>
            {!data.configured && (
              <p className="muted small-text">
                Para ativar, coloque a chave do Google AI Studio em <code>GEMINI_API_KEY</code> no arquivo <code>.env</code> e reinicie a API e o
                worker.
              </p>
            )}
            <div className="actions">
              {data.canToggle && (
                <button
                  type="button"
                  className={data.enabled ? 'secondary' : ''}
                  onClick={() => void save(data.enabled ? 'IA desligada.' : 'IA ligada.', () => api('PATCH', '/ai/settings', { enabled: !data.enabled }))}
                >
                  {data.enabled ? 'Desligar a IA' : 'Ligar a IA'}
                </button>
              )}
              <ModelPicker current={data.model} onSave={(model) => save('Modelo salvo.', () => api('PATCH', '/ai/settings', { model }))} />
            </div>
          </div>

          <GovernanceEditor
            current={data.governancePrompt}
            fallback={data.defaultGovernancePrompt}
            onSave={(governancePrompt) => save('Prompt de governança salvo.', () => api('PATCH', '/ai/settings', { governancePrompt }))}
          />
          <Skills skills={data.skills} onSave={save} />
          <AccessList onError={(error) => setFeedback({ error })} />
          <RequestLog />
        </>
      )}
    </Section>
  );
}

function ModelPicker({ current, onSave }: { current: string; onSave: (model: string) => void }) {
  const [model, setModel] = useState(current);
  return (
    <label className="inline">
      <span className="muted small-text">Modelo</span>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {[...new Set([current, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'])].map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {model !== current && (
        <button type="button" className="secondary" onClick={() => onSave(model)}>
          Salvar modelo
        </button>
      )}
    </label>
  );
}

function GovernanceEditor({ current, fallback, onSave }: { current: string; fallback: string; onSave: (prompt: string | null) => void }) {
  const [text, setText] = useState(current);
  return (
    <details className="top-gap">
      <summary>
        <strong>Prompt de governança</strong> {current === fallback ? <span className="badge soft">padrão</span> : <span className="badge info">editado</span>}
      </summary>
      <p className="muted small-text">
        As regras fixas do sistema (não alterar texto, não sair do escopo, responder só no formato pedido) entram sempre depois deste prompt e
        das habilidades, e não podem ser desligadas por aqui.
      </p>
      <textarea rows={14} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} aria-label="Prompt de governança" />
      <div className="actions">
        <button type="button" disabled={text.trim().length < 20 || text === current} onClick={() => onSave(text)}>
          Salvar prompt
        </button>
        {current !== fallback && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setText(fallback);
              onSave(null);
            }}
          >
            Voltar ao padrão
          </button>
        )}
      </div>
    </details>
  );
}

function Skills({ skills, onSave }: { skills: AiSkillItem[]; onSave: (label: string, call: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<{ id?: string; name: string; content: string; active: boolean } | null>(null);
  return (
    <>
      <h3 className="top-gap">Habilidades</h3>
      <p className="muted small-text">Instruções adicionais que entram no prompt da IA (padrão de qualidade da diagramação, convenções da equipe).</p>
      <ul className="list compact">
        {skills.map((skill) => (
          <li key={skill.id}>
            <span className="who grow">
              <strong>{skill.name}</strong>
              <span className="muted small-text">
                {skill.active ? 'Ativa' : 'Inativa'} · {skill.updatedBy}, {dateTime(skill.updatedAt)}
              </span>
            </span>
            <button type="button" className="secondary" onClick={() => setEditing({ id: skill.id, name: skill.name, content: skill.content, active: skill.active })}>
              Editar
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                window.confirm(`Remover a habilidade "${skill.name}"?`) && void onSave('Habilidade removida.', () => api('DELETE', `/ai/skills/${skill.id}`))
              }
            >
              Remover
            </button>
          </li>
        ))}
        {!skills.length && <li className="muted">Nenhuma habilidade cadastrada.</li>}
      </ul>
      {editing ? (
        <div className="card">
          <input placeholder="Nome" value={editing.name} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <textarea
            rows={8}
            placeholder="Instruções da habilidade"
            value={editing.content}
            maxLength={12_000}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
          <label className="check">
            <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Ativa
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={editing.name.trim().length < 2 || editing.content.trim().length < 5}
              onClick={() =>
                void onSave('Habilidade salva.', async () => {
                  const body = { name: editing.name, content: editing.content, active: editing.active };
                  await (editing.id ? api('PUT', `/ai/skills/${editing.id}`, body) : api('POST', '/ai/skills', body));
                  setEditing(null);
                })
              }
            >
              Salvar habilidade
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => setEditing({ name: '', content: '', active: true })}>
          Nova habilidade
        </button>
      )}
    </>
  );
}

function AccessList({ onError }: { onError: (error: string) => void }) {
  const access = useLoad(() => api<{ items: AiAccessItem[] }>('GET', '/ai/access'), []);
  return (
    <>
      <h3 className="top-gap">Acesso por pessoa</h3>
      <p className="muted small-text">Todos usam por padrão. O Supervisor limita as pessoas das próprias equipes; o Diretor, qualquer pessoa.</p>
      <Feedback error={access.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Equipes</th>
              <th>Acesso à IA</th>
            </tr>
          </thead>
          <tbody>
            {access.data?.items.map((item) => (
              <tr key={item.userId}>
                <td className="name-cell">
                  <strong>{item.name}</strong>
                  <span className="muted small-text block-line">{item.email}</span>
                </td>
                <td>{item.teams.join(', ') || '—'}</td>
                <td>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={item.allowed}
                      onChange={(e) =>
                        api('PUT', `/ai/access/${item.userId}`, { allowed: e.target.checked })
                          .then(access.reload)
                          .catch((caught: unknown) => onError(message(caught)))
                      }
                    />{' '}
                    {item.allowed ? 'Liberado' : 'Limitado'}
                  </label>
                  {item.setBy && <span className="muted small-text block-line">por {item.setBy}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RequestLog() {
  const log = useLoad(() => api<{ last30Days: Partial<Record<AiOutcomeStatus, number>>; items: AiRequestItem[] }>('GET', '/ai/requests'), []);
  const totals = log.data?.last30Days ?? {};
  return (
    <>
      <h3 className="top-gap">Registro de chamadas</h3>
      <p className="muted small-text">
        Últimos 30 dias:{' '}
        {(Object.keys(aiStatusLabel) as AiOutcomeStatus[]).map((status) => `${aiStatusLabel[status]} ${totals[status] ?? 0}`).join(' · ')}
      </p>
      <Feedback error={log.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Pessoa</th>
              <th>Tarefa</th>
              <th>Resultado</th>
              <th>Documento</th>
            </tr>
          </thead>
          <tbody>
            {log.data?.items.map((item) => (
              <tr key={item.id}>
                <td>{dateTime(item.at)}</td>
                <td>{item.user ?? 'Sistema'}</td>
                <td>{item.taskLabel}</td>
                <td>
                  <span className={`badge ${STATUS_TONE[item.status]}`}>{aiStatusLabel[item.status]}</span>
                  {item.reason && <span className="muted small-text block-line">{item.reason}</span>}
                </td>
                <td>{item.document ?? '—'}</td>
              </tr>
            ))}
            {log.data && !log.data.items.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhuma chamada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Auxílio da IA na tela da tradução: conferir glossário, sugerir diagramação (prévia + aprovação) e tirar dúvidas do
 * processo. Fica fora do caminho: sem IA disponível, mostra só uma linha e nada mais muda na tela.
 */
export function AiAssist({ translationId, status, onApplied }: { translationId: string; status: TranslationStatus; onApplied: () => void }) {
  const ai = useLoad(() => api<AiStatus>('GET', '/ai/status'), []);
  const [version, setVersion] = useState(0);
  const pending = useLoad(() => api<{ combination: AiCombination | null }>('GET', `/translations/${translationId}/ai/layout`), [translationId, version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const [glossary, setGlossary] = useState<{ findings: Array<{ block: number; term: string; problem: string }>; systemFindings: string[] } | null>(
    null,
  );
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  if (!ai.data) return null;
  const editable = status === 'in_review' || status === 'awaiting_approval';
  const combination = pending.data?.combination ?? null;

  if (!ai.data.available) {
    return (
      <p className="muted small-text">
        Auxílio da IA indisponível
        {!ai.data.configured ? ' (sem chave no servidor)' : !ai.data.enabled ? ' (desligada)' : !ai.data.allowed ? ' (acesso limitado pela liderança)' : ''}.
      </p>
    );
  }

  async function run<T>(key: string, call: () => Promise<T>) {
    setBusy(key);
    setFeedback({});
    try {
      return await call();
    } catch (caught) {
      setFeedback({ error: message(caught) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  const outcome = (result: { status: string; reason?: string | null }, ok: string) =>
    setFeedback(result.status === 'ok' ? { ok } : { error: `${aiStatusLabel[result.status as AiOutcomeStatus] ?? result.status}: ${result.reason ?? ''}` });

  return (
    <details className="card top-gap" open={!!combination}>
      <summary>
        <strong>Auxílio da IA</strong> {combination && <span className="badge info">Sugestão de diagramação para aprovar</span>}
      </summary>
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={async () => {
            const result = await run('glossary', () =>
              api<{ status: string; reason: string | null; findings: NonNullable<typeof glossary>['findings']; systemFindings: string[] }>(
                'POST',
                `/translations/${translationId}/ai/glossary-check`,
              ),
            );
            if (!result) return;
            outcome(result, 'Glossário conferido.');
            setGlossary(result);
          }}
        >
          {busy === 'glossary' ? 'Conferindo…' : 'Verificar glossário'}
        </button>
        {editable && (
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={async () => {
              const result = await run('layout', () =>
                api<{ status: string; reason: string | null }>('POST', `/translations/${translationId}/ai/layout`),
              );
              if (!result) return;
              outcome(result, 'Sugestão pronta: confira a prévia e aprove ou descarte.');
              setVersion((current) => current + 1);
            }}
          >
            {busy === 'layout' ? 'Pensando na diagramação…' : 'Sugerir diagramação'}
          </button>
        )}
      </div>

      {glossary && (
        <ul className="list compact">
          {glossary.findings.map((finding, index) => (
            <li key={`a${index}`}>
              Bloco {finding.block}: “{finding.term}” — {finding.problem}
            </li>
          ))}
          {glossary.systemFindings.map((text, index) => (
            <li key={`s${index}`} className="muted">
              {text}
            </li>
          ))}
          {!glossary.findings.length && !glossary.systemFindings.length && <li className="muted">Nenhum termo do glossário fora do padrão.</li>}
        </ul>
      )}

      {combination && editable && (
        <CombinationReview
          combination={combination}
          onDone={(approved) => {
            setFeedback({ ok: approved ? 'Diagramação aplicada; o sistema passa a usá-la em documentos parecidos.' : 'Sugestão descartada.' });
            setVersion((current) => current + 1);
            if (approved) onApplied();
          }}
          onError={(error) => setFeedback({ error })}
        />
      )}

      <form
        className="actions top-gap"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run('ask', () =>
            api<{ status: string; answer: string | null; reason?: string }>('POST', '/ai/ask', { question, translationId }),
          );
          if (!result) return;
          if (result.status !== 'ok') outcome(result, '');
          setAnswer(result.answer);
        }}
      >
        <input
          className="grow"
          placeholder="Dúvida sobre o processo (ex.: o que falta para concluir?)"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="secondary" disabled={!!busy || question.trim().length < 3}>
          {busy === 'ask' ? 'Perguntando…' : 'Perguntar'}
        </button>
      </form>
      {answer && <p className="ai-answer">{answer}</p>}
    </details>
  );
}

function CombinationReview({
  combination,
  onDone,
  onError,
}: {
  combination: AiCombination;
  onDone: (approved: boolean) => void;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const decide = (approve: boolean) => {
    setBusy(true);
    api('POST', `/ai/layout-combinations/${combination.id}/${approve ? 'approve' : 'reject'}`)
      .then(() => onDone(approve))
      .catch((caught: unknown) => onError(message(caught)))
      .finally(() => setBusy(false));
  };
  const pdf = `/api/v1/ai/layout-combinations/${combination.id}/preview?format=pdf`;
  return (
    <div className="top-gap">
      <h4>Sugestão de diagramação</h4>
      {combination.rationale && <p className="muted small-text">{combination.rationale}</p>}
      <ul className="list compact small-text">
        {combination.styles.map((style) => (
          <li key={style.role}>
            <span>
              <strong>{style.label}</strong>: {ALIGN_LABEL[style.align]}
              {style.bold ? ', negrito' : ''}
              {style.size !== 'normal' ? `, tamanho ${SIZE_LABEL[style.size]}` : ''}
            </span>
          </li>
        ))}
        <li>
          <span>
            <strong>campos</strong>: {combination.fieldsAsTable ? `em tabela${combination.labelWidth ? ` (rótulo ${combination.labelWidth}%)` : ''}` : 'em linhas'}
          </span>
        </li>
      </ul>
      <p className="muted small-text">O texto não muda: só a diagramação. Confira a prévia antes de aprovar.</p>
      <iframe key={pdf} className="word-frame" title="Prévia da sugestão" src={pdf} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => decide(true)}>
          Aprovar diagramação
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => decide(false)}>
          Descartar
        </button>
        <a className="button secondary" href={`/api/v1/ai/layout-combinations/${combination.id}/preview`}>
          Baixar Word da prévia
        </a>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useConfirm } from './ConfirmDialog';
import {
  api,
  LANGUAGES,
  languageLabel,
  stageLabel,
  type Align,
  type DraftContent,
  type InspectionEvent,
  type Me,
  type Stage,
  type TranslationSummary,
} from './api';
import { dateTime, Feedback, message } from './ui';

export function elapsedLabel(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return 'Ainda não disponível';
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}

export function DocumentTiming({ translation: t }: { translation: TranslationSummary }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const timing = t.timing;
  if (!timing) return null;
  const idle = Math.max(0, (clock - Date.parse(timing.lastActivityAt)) / 1000);
  const waiting =
    timing.completedAt && !timing.firstDownloadedAt
      ? Math.max(0, (clock - Date.parse(timing.completedAt)) / 1000)
      : timing.waitingDownloadSeconds;
  return (
    <div className="document-timing" aria-label="Tempos do documento">
      <div>
        <span className="muted">Estimativa de produção</span>
        <strong>{elapsedLabel(timing.estimatedSeconds)}</strong>
        <small className="muted">
          {timing.estimateSamples
            ? `Histórico de ${timing.estimateSamples} documento(s) comparáveis`
            : 'Estimativa inicial por páginas; será ajustada pelo histórico'}
        </small>
      </div>
      <div>
        <span className="muted">Produção até a conclusão</span>
        <strong>{elapsedLabel(timing.completionSeconds)}</strong>
        <small className="muted">{timing.completedAt ? `Concluído em ${dateTime(timing.completedAt)}` : 'Aguardando conclusão'}</small>
      </div>
      <div>
        <span className="muted">{timing.firstDownloadedAt ? 'Conclusão → primeiro download' : 'Pronto sem download'}</span>
        <strong>{timing.completedAt ? elapsedLabel(waiting) : 'Ainda não concluído'}</strong>
        <small className="muted">
          {timing.firstDownloadedAt
            ? `Primeiro download em ${dateTime(timing.firstDownloadedAt)}`
            : 'A visualização da prévia não conta como download'}
        </small>
      </div>
      <div>
        <span className="muted">Sem atividade</span>
        <strong>{elapsedLabel(idle)}</strong>
        <small className="muted">Última atividade em {dateTime(timing.lastActivityAt)}</small>
      </div>
    </div>
  );
}

const REVIEW_STAGES: Stage[] = ['correction', 'translation', 'layout', 'review'];

export function InspectionGate({
  t,
  revision,
  reviewed,
  onReviewed,
  busy,
  onDone,
}: {
  t: TranslationSummary;
  revision: number;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  busy: boolean;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const [rejecting, setRejecting] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [comment, setComment] = useState('');
  const [reprocess, setReprocess] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = t.reviewLifecycle?.blocked ?? false;
  const attempts = t.reviewLifecycle?.consecutiveRejections ?? 0;
  const canInspect = t.permissions.accept || t.permissions.edit || t.permissions.approve;
  async function reject() {
    const completed = t.status === 'awaiting_approval';
    if (
      completed &&
      !(await confirm('Este documento já está pronto. Deseja devolvê-lo para correção? Será necessária uma nova conferência e aprovação.'))
    )
      return;
    setSending(true);
    setError(null);
    try {
      await api('POST', `/translations/${t.id}/inspections`, {
        decision: 'rejected',
        baseRevision: revision,
        failedStages: stages,
        comment: comment.trim(),
        scope: t.batch.inspectionMode ?? 'all',
        reprocess,
        ...(completed ? { confirmCompleted: true } : {}),
      });
      onReviewed(false);
      setRejecting(false);
      setComment('');
      setStages([]);
      onDone();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="card inspection-gate" aria-labelledby="inspection-heading">
      <div className="word-head">
        <h3 id="inspection-heading">Conferência antes da aprovação</h3>
        <span className={`badge ${attempts ? 'warn' : 'soft'}`}>{attempts} de 3 reprovações consecutivas</span>
      </div>
      {blocked ? (
        <p className="alert error">
          <strong>Erros consecutivos.</strong> O documento foi reprovado três vezes. Registre uma nova forma de formatação com alterações
          reais antes de tentar novamente.
        </p>
      ) : (
        <>
          <p className="muted small-text">Compare o original e o Word acima. Uma alteração na revisão exige uma nova conferência.</p>
          {t.batch.inspectionMode === 'sample' && (
            <p className="alert info">
              Esta remessa usa inspeção por amostra ({t.batch.inspectionSampleSize ?? 10} documentos). A escolha fica na auditoria e cada
              documento conferido registra a própria decisão.
            </p>
          )}
          {canInspect && (
            <label className="check">
              <input type="checkbox" checked={reviewed} disabled={busy || sending} onChange={(e) => onReviewed(e.target.checked)} />
              Comparei o original e o Word desta revisão.
            </label>
          )}
          {canInspect && (
            <button className="danger small" disabled={busy || sending || !reviewed} onClick={() => setRejecting(!rejecting)}>
              Reprovar e indicar as fases com falha
            </button>
          )}
          {rejecting && (
            <div className="form">
              <fieldset disabled={busy || sending}>
                <legend>Em quais fases o documento falhou?</legend>
                <div className="inspection-stages">
                  {REVIEW_STAGES.map((stage) => (
                    <label className="check" key={stage}>
                      <input
                        type="checkbox"
                        checked={stages.includes(stage)}
                        onChange={(e) =>
                          setStages((current) => (e.target.checked ? [...current, stage] : current.filter((value) => value !== stage)))
                        }
                      />
                      {stageLabel[stage]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Descreva o que precisa ser refeito
                <textarea value={comment} minLength={3} maxLength={2000} onChange={(e) => setComment(e.target.value)} rows={3} />
              </label>
              <label className="check">
                <input type="checkbox" checked={reprocess} disabled={attempts >= 2} onChange={(e) => setReprocess(e.target.checked)} />
                Retraduzir automaticamente após devolver {attempts >= 2 && '(novo formato será exigido na terceira reprovação)'}
              </label>
              <button
                className="primary"
                disabled={busy || sending || !stages.length || comment.trim().length < 3}
                onClick={() => void reject()}
              >
                {sending ? 'Registrando…' : 'Registrar reprovação'}
              </button>
            </div>
          )}
        </>
      )}
      <Feedback error={error} />
    </section>
  );
}

export function LanguageCorrection({ t, me, onDone }: { t: TranslationSummary; me: Me; onDone: () => void }) {
  const confirm = useConfirm();
  const [source, setSource] = useState(t.sourceLanguage);
  const [target, setTarget] = useState(t.targetLanguage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCorrect =
    me.user.orgRole === 'director' ||
    me.memberships.some((m) => m.teamId === t.team?.id && m.role === 'leader') ||
    t.assignee?.id === me.user.id;
  if (!canCorrect || ['processing', 'cancelled'].includes(t.status) || t.reviewLifecycle?.blocked) return null;
  async function change() {
    const completed = t.status === 'approved' || t.status === 'awaiting_approval';
    if (
      completed &&
      !(await confirm(
        'Este documento já está pronto. Tem certeza de que deseja corrigir os idiomas? O arquivo final atual será invalidado e uma nova tradução precisará ser revisada e aprovada.',
      ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/translations/${t.id}/languages`, {
        sourceLanguage: source,
        targetLanguage: target,
        reason: reason.trim(),
        ...(completed ? { confirmCompleted: true } : {}),
      });
      onDone();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card workflow-adjustment">
      <summary>Corrigir idiomas da documentação</summary>
      <p className="muted small-text">
        O documento será processado no novo par, usando o fluxo escolhido com ou sem IA. O motivo e os idiomas anteriores ficam na
        auditoria.
      </p>
      <div className="filters">
        <label>
          Idioma original
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {languageLabel[language]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Idioma da tradução
          <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {languageLabel[language]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Motivo da correção
        <textarea rows={2} minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Feedback error={error} />
      <button
        className="primary"
        disabled={busy || source === target || (source === t.sourceLanguage && target === t.targetLanguage) || reason.trim().length < 5}
        onClick={() => void change()}
      >
        {busy ? 'Atualizando…' : 'Corrigir idiomas e retraduzir'}
      </button>
    </details>
  );
}

export function RegisterFormat({
  t,
  revision,
  draft,
  onDraft,
  onEdit,
  onDone,
}: {
  t: TranslationSummary;
  revision: number;
  draft: DraftContent;
  onDraft: (draft: DraftContent) => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [explanation, setExplanation] = useState('');
  const [blockIndex, setBlockIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!t.permissions.registerNewFormat) return null;
  const block = draft.blocks[blockIndex];
  function align(value: Align) {
    onDraft({
      ...draft,
      blocks: draft.blocks.map((item, index) =>
        index === blockIndex && (item.kind === 'paragraph' || item.kind === 'heading') ? { ...item, align: value, origin: 'human' } : item,
      ),
    });
    onEdit();
  }
  function move(delta: number) {
    const next = blockIndex + delta;
    if (next < 0 || next >= draft.blocks.length) return;
    const blocks = [...draft.blocks];
    [blocks[blockIndex], blocks[next]] = [blocks[next]!, blocks[blockIndex]!];
    onDraft({ ...draft, blocks });
    setBlockIndex(next);
    onEdit();
  }
  async function register() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/translations/${t.id}/formats`, {
        name: name.trim(),
        explanation: explanation.trim(),
        baseRevision: revision,
        draft,
      });
      onDone();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card format-registration" open={t.reviewLifecycle.blocked}>
      <summary>Registrar nova forma de formatação</summary>
      <p className="muted">
        Corrija a estrutura, o alinhamento, os estilos ou as tabelas no editor. Alterar somente o texto ou o nome do formato não remove o
        bloqueio. Depois de registrar, compare novamente o Word e o original antes de aprovar.
      </p>
      <div className="filters">
        <label>
          Bloco do documento
          <select value={blockIndex} onChange={(e) => setBlockIndex(Number(e.target.value))}>
            {draft.blocks.map((item, index) => (
              <option key={index} value={index}>
                {index + 1} · {item.kind === 'table' ? 'Tabela' : item.kind === 'heading' ? 'Título' : 'Texto'}
              </option>
            ))}
          </select>
        </label>
        {block && (block.kind === 'paragraph' || block.kind === 'heading') && (
          <label>
            Alinhamento
            <select value={block.align} onChange={(e) => align(e.target.value as Align)}>
              <option value="left">À esquerda</option>
              <option value="center">Centralizado</option>
              <option value="right">À direita</option>
              <option value="justify">Justificado</option>
            </select>
          </label>
        )}
        <button disabled={blockIndex <= 0} onClick={() => move(-1)}>
          Mover bloco para cima
        </button>
        <button disabled={blockIndex >= draft.blocks.length - 1} onClick={() => move(1)}>
          Mover bloco para baixo
        </button>
        <button onClick={onEdit}>Editar texto no documento</button>
      </div>
      <label>
        Nome da nova formatação
        <input value={name} minLength={3} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Explique o que mudou
        <textarea rows={3} minLength={10} maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      <Feedback error={error} />
      <button
        className="primary"
        disabled={busy || name.trim().length < 3 || explanation.trim().length < 10}
        onClick={() => void register()}
      >
        {busy ? 'Registrando…' : 'Registrar formato e gerar nova revisão'}
      </button>
    </details>
  );
}

export function InspectionHistory({ items }: { items: InspectionEvent[] }) {
  if (!items.length) return null;
  return (
    <details className="card">
      <summary>Histórico de conferências e reprovações ({items.length})</summary>
      <ol className="inspection-history">
        {items.map((item) => (
          <li key={item.id}>
            <strong>
              Revisão {item.revision} · {item.decision === 'approved' ? 'Conferência aprovada' : 'Reprovada'}
            </strong>
            <span className="muted small-text">
              {dateTime(item.inspectedAt)} · {item.inspectedBy} · {item.scope === 'sample' ? 'Amostra' : 'Inspeção completa'} · formato{' '}
              {item.formatGeneration}
            </span>
            {item.failedStages.length > 0 && <span>Falhas em: {item.failedStages.map((stage) => stageLabel[stage]).join(', ')}</span>}
            {item.comment && <p>{item.comment}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

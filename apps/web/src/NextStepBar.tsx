import type { ReactNode } from 'react';
import type { TranslationSummary } from './api';
import { shortcutProps } from './shortcuts';

const FLOW = ['Envio', 'Tradução', 'Revisão', 'Prévia em Word', 'Conclusão', 'Word final'];

/** Em que trecho da linha do fluxo a tradução está agora. */
const stageOf = (status: TranslationSummary['status']) =>
  status === 'queued' || status === 'processing' ? 1 : status === 'in_review' ? 3 : status === 'awaiting_approval' ? 4 : 5;

export interface NextStepActions {
  onClaim: () => void;
  onSave: () => void;
  onAccept: () => void;
  onReject: () => void;
  onConclude: () => void;
  onRegisterFormat: () => void;
  onReprocess: () => void;
  onShowIssues: () => void;
}

/**
 * Próximo passo (2026-10-28): uma barra presa no pé da tela da tradução, com a etapa atual, o que falta e a ação que
 * leva adiante. Quem confere o original e o Word não precisa rolar até o fim para marcar a conferência nem voltar ao
 * topo para aprovar.
 */
export function NextStepBar({
  t,
  busy,
  dirty,
  errors,
  reviewed,
  needsComparison,
  onReviewed,
  actions,
}: {
  t: TranslationSummary;
  busy: boolean;
  dirty: boolean;
  errors: number;
  reviewed: boolean;
  needsComparison: boolean;
  onReviewed: (value: boolean) => void;
  actions: NextStepActions;
}) {
  if (t.status === 'cancelled') return null;
  const stage = stageOf(t.status);
  const blocked = t.reviewLifecycle?.blocked ?? false;
  const canInspect = t.permissions.accept || t.permissions.edit || t.permissions.approve;

  let text: string;
  let content: ReactNode = null;
  if (t.permissions.claim) {
    text = 'Ninguém assumiu este documento ainda. Assuma para conferir e concluir.';
    content = (
      <button className="primary" disabled={busy} onClick={actions.onClaim}>
        Assumir documento
      </button>
    );
  } else if (t.status === 'queued' || t.status === 'processing') {
    text = 'Traduzindo e revisando. A prévia em Word aparece nesta tela sozinha.';
  } else if (t.status === 'failed') {
    text = 'O processamento falhou.';
    if (t.permissions.reprocess)
      content = (
        <button className="primary" disabled={busy} onClick={actions.onReprocess}>
          Processar de novo
        </button>
      );
  } else if (dirty) {
    text = 'Há alterações no texto que ainda não foram salvas.';
    content = (
      <button className="primary" disabled={busy} {...shortcutProps('Ctrl+S')} onClick={actions.onSave}>
        Salvar alterações
      </button>
    );
  } else if (blocked && (t.status === 'in_review' || t.status === 'awaiting_approval')) {
    text = 'Três reprovações seguidas: registre uma nova forma de formatação antes de conferir de novo.';
    content = <button onClick={actions.onRegisterFormat}>Registrar nova forma</button>;
  } else if (t.status === 'in_review' && t.permissions.accept) {
    text =
      needsComparison && !reviewed
        ? 'Compare o original e o Word acima e marque a conferência.'
        : t.permissions.approve
          ? 'Conferido. Aprove para concluir.'
          : 'Conferido. Aprove o Word para seguir.';
    content = (
      <>
        {needsComparison && canInspect && (
          <label className="check next-step-check">
            <input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => onReviewed(event.target.checked)} />
            Comparei o original e o Word
          </label>
        )}
        <button className="danger ghost" disabled={busy || (needsComparison && !reviewed)} onClick={actions.onReject}>
          Reprovar…
        </button>
        <button className="primary" disabled={busy || (needsComparison && !reviewed)} onClick={actions.onAccept}>
          {t.permissions.approve ? 'Aprovar e concluir' : 'Aprovar Word'}
        </button>
      </>
    );
  } else if (t.status === 'in_review') {
    text = t.assignee ? `Em conferência com ${t.assignee.name}.` : 'Em conferência.';
  } else if (t.status === 'awaiting_approval' && t.permissions.approve) {
    text = t.useMask ? 'Pronta para concluir: escolha com ou sem tradutor juramentado.' : 'Pronta para concluir.';
    content = (
      <button className="primary" disabled={busy} onClick={actions.onConclude}>
        Concluir
      </button>
    );
  } else if (t.status === 'awaiting_approval') {
    text = 'Pronta. Aguardando a conclusão pelo responsável.';
  } else {
    text = t.permissions.download ? 'Concluída: o Word e o PDF finais estão liberados.' : 'Concluída.';
    if (t.permissions.download)
      content = (
        <>
          <a className="button" href={`/api/v1/translations/${t.id}/final?format=docx&download=true`}>
            Baixar Word
          </a>
          <a className="button primary" href={`/api/v1/translations/${t.id}/final?format=pdf&download=true`}>
            Baixar PDF
          </a>
        </>
      );
  }

  return (
    <div className="next-step-bar" role="region" aria-label="Próximo passo">
      <div className="next-step-text">
        <span className="next-step-stage">
          Etapa {stage + 1} de {FLOW.length} · {FLOW[stage]}
        </span>
        <span role="status">
          {text}
          {errors > 0 && t.status !== 'approved' && (
            <>
              {' '}
              <button type="button" className="link" onClick={actions.onShowIssues}>
                {errors} ponto(s) para conferir
              </button>
            </>
          )}
        </span>
      </div>
      {content && <div className="next-step-actions">{content}</div>}
    </div>
  );
}

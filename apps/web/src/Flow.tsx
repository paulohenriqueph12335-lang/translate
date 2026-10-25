import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  api,
  ApiError,
  formatBytes,
  modeLabel,
  pairLabel,
  splitPair,
  uploadContent,
  type Batch,
  type DocumentCategory,
  type DocumentItem,
  type Team,
  type TranslationMode,
  type TranslationSummary,
  type UploadLimits,
} from './api';
import { ModeSelect, PairSelect } from './Modes';
import { Feedback, message, useLoad } from './ui';
import { captureUpload, planUploadRetries, type UploadSnapshot } from './upload-plan';
import { PdfPreview } from './PdfPreview';
import { DocumentCategorySelect, useDocumentCategories } from './DocumentClassification';
import { TranslationSteps } from './TranslationSteps';
import { FinalDelivery } from './DeliveryActions';

/**
 * Fluxo automático (ADR-017): coloca o documento e o sistema traduz, revisa e entrega a prévia em Word; quem aprova
 * leva à próxima fase e o Word final sai em seguida.
 */

const extensionOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

export function useBatchProtocol(fileCount: number) {
  const [protocol, setProtocol] = useState('');
  const [withoutProtocol, setWithoutProtocol] = useState(false);
  const [reason, setReason] = useState('');
  const [inspection, setInspection] = useState<'' | 'all' | 'sample'>('');
  const validProtocol = withoutProtocol
    ? reason.trim().length >= 10 && /[\p{L}]/u.test(reason)
    : /^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,79}$/u.test(protocol.trim());
  return {
    ready: validProtocol && (fileCount < 20 || !!inspection),
    description: withoutProtocol ? `Sem protocolo: ${reason.trim()}` : protocol.trim(),
    payload: {
      ...(withoutProtocol ? { protocolOmissionReason: reason.trim() } : { protocol: protocol.trim() }),
      inspectionMode: fileCount >= 20 ? inspection : 'all',
    },
    fields: (
      <fieldset className="protocol-fields top-gap doc-protocol-fields">
        <legend>Protocolo da remessa</legend>
        <p className="muted small-text">
          Identifique a remessa antes de traduzir. O protocolo aparecerá no início dos nomes de Word e PDF e poderá ser pesquisado na
          auditoria.
        </p>
        <label className="check">
          <input type="checkbox" checked={withoutProtocol} onChange={(event) => setWithoutProtocol(event.target.checked)} />
          Esta remessa não possui protocolo
        </label>
        {withoutProtocol ? (
          <label>
            Explique por que não há protocolo
            <textarea
              required
              minLength={10}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Informe uma justificativa para a auditoria (mínimo 10 caracteres)."
            />
          </label>
        ) : (
          <label>
            Protocolo
            <input
              required
              minLength={3}
              maxLength={80}
              value={protocol}
              onChange={(event) => setProtocol(event.target.value)}
              placeholder="ABC-10003"
            />
            <small className="muted">Use letras, números, espaços, ponto, hífen ou sublinhado.</small>
          </label>
        )}
        {fileCount >= 20 && (
          <label className="top-gap">
            Esta remessa contém {fileCount} arquivos. Como deseja inspecionar o original e o Word?
            <select required value={inspection} onChange={(event) => setInspection(event.target.value as 'all' | 'sample')}>
              <option value="" disabled>
                Escolha a inspeção…
              </option>
              <option value="all">Inspecionar todos os documentos</option>
              <option value="sample">Inspecionar uma amostra inicial de 10 documentos</option>
            </select>
            <small className="muted">
              A escolha fica registrada. Você pode abrir qualquer documento individualmente; a amostra não aprova os demais automaticamente.
            </small>
          </label>
        )}
      </fieldset>
    ),
  };
}

export function NewTranslation({
  teams,
  isDirector,
  onStarted,
  onCancel,
}: {
  /** Equipes da pessoa (vazio para o Diretor). */
  teams: Team[];
  isDirector: boolean;
  onStarted: (translationIds: string[]) => void;
  onCancel: () => void;
}) {
  const limits = useLoad(() => api<UploadLimits>('GET', '/batches/limits'), []);
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0]!.id : '');
  const [pair, setPair] = useState('pt-en');
  const [mode, setMode] = useState<TranslationMode>('sworn');
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory | ''>('');
  const categories = useDocumentCategories();
  const protocol = useBatchProtocol(files.length);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const submission = useRef<UploadSnapshot<File> | null>(null);
  const [locked, setLocked] = useState(false);
  const [permanentFailure, setPermanentFailure] = useState(false);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const sworn = mode === 'sworn';
  const accepted = limits.data?.extensions ?? ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'];
  const fileProblem = (file: File) =>
    !file.size
      ? 'Arquivo vazio'
      : limits.data && file.size > limits.data.maxFileMb * 1024 * 1024
        ? `Acima de ${limits.data.maxFileMb} MB`
        : null;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const filesReady =
    !!limits.data &&
    files.length > 0 &&
    files.length <= limits.data.maxBatchFiles &&
    totalBytes <= limits.data.maxBatchMb * 1024 * 1024 &&
    files.every((file) => !fileProblem(file));
  const readyToSend = filesReady && protocol.ready && (isDirector || !!teamId);
  const nextReady = [filesReady, protocol.ready, isDirector || !!teamId, readyToSend][step];
  const advance = () => {
    if (!nextReady || busy || locked) return;
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  };

  const add = (list: FileList | null) => {
    if (busy || locked) return;
    const picked = list ? [...list] : [];
    if (picked.length) setFiles((current) => [...current, ...picked.filter((file) => accepted.includes(extensionOf(file.name)))]);
  };

  async function start() {
    if (busy) return;
    if (!readyToSend) return;
    if (!protocol.ready) {
      setError('Informe o protocolo ou sua justificativa e escolha a inspeção para remessas grandes.');
      return;
    }
    setBusy(true);
    setError(null);
    const [sourceLanguage, targetLanguage] = splitPair(pair);
    const active =
      submission.current ??
      captureUpload(
        files,
        {
          ...(isDirector ? {} : { teamId }),
          translation: { sourceLanguage, targetLanguage },
          mode,
          ...(documentCategory ? { documentCategory } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          files: files.map((file) => ({ name: file.name, size: file.size })),
          ...protocol.payload,
        },
        crypto.randomUUID(),
      );
    submission.current = active;
    setLocked(true);
    try {
      const created = await api<{ batch: Batch; documents: DocumentItem[] }>('POST', '/batches', active.body, {
        'Idempotency-Key': active.key,
      });
      active.batchId = created.batch.id;
      const waiting = planUploadRetries(created.documents, active.files);
      for (const { document, file } of waiting) {
        await uploadContent(document.id, file, (fraction) => setProgress((current) => new Map(current).set(document.id, fraction)));
      }
      // Cada documento armazenado entra sozinho na fila; abre as traduções criadas.
      const ids: string[] = [];
      for (const doc of created.documents.filter(
        (document) => document.status === 'stored' || waiting.some((item) => item.document.id === document.id),
      )) {
        const found = await api<{ items: TranslationSummary[] }>('GET', `/translations?documentId=${doc.id}&limit=1`);
        if (found.items[0]) ids.push(found.items[0].id);
      }
      setCreatedIds(ids);
      const rejected = created.documents.filter((doc) => doc.status === 'rejected' || doc.status === 'cancelled');
      if (rejected.length) {
        setPermanentFailure(true);
        throw new Error(
          `A remessa possui ${rejected.length} arquivo(s) recusado(s) ou cancelado(s): ${rejected.map((doc) => doc.name).join(', ')}. Confira os motivos em Envios e crie uma nova remessa para os arquivos corrigidos. As traduções válidas foram preservadas.`,
        );
      }
      if (!ids.length)
        throw new Error('A remessa ainda não possui traduções disponíveis. Confira o andamento em Envios antes de tentar novamente.');
      onStarted(ids);
    } catch (caught) {
      if (!active.batchId && caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        submission.current = null;
        setLocked(false);
      }
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  const sending = busy && progress.size > 0;
  return (
    <div className="card new-translation doc-domain doc-form">
      <h3>Nova tradução</h3>
      <p className="muted small-text">
        Siga as etapas para iniciar. O sistema produz a tradução e você compara o original e o Word antes da aprovação.
      </p>
      <TranslationSteps step={step} onChange={setStep} disabled={busy || locked} />
      <fieldset className="doc-borderless-fields" disabled={busy || locked}>
        {step === 0 && (
          <>
            <div className="mode-field">
              <span className="field-label">Modalidade da tradução</span>
              <ModeSelect value={mode} onChange={setMode} />
              {sworn && (
                <p className="muted small-text">O tradutor juramentado e a máscara são escolhidos na conclusão, e são opcionais.</p>
              )}
            </div>
            <div
              className={`dropzone ${dragging ? 'over' : ''}`}
              onDragOver={(event: DragEvent) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                setDragging(false);
                add(event.dataTransfer.files);
              }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={busy || locked ? -1 : 0}
              aria-disabled={busy || locked}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
            >
              <strong>
                {files.length ? `${files.length} arquivo(s) escolhido(s)` : 'Arraste o documento aqui ou clique para escolher'}
              </strong>
              <span className="muted">
                {accepted.map((ext) => ext.toUpperCase()).join(', ')}
                {limits.data ? ` · até ${limits.data.maxFileMb} MB` : ''}
              </span>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={accepted.map((ext) => `.${ext}`).join(',')}
                onChange={(event) => {
                  add(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="list compact files doc-cards doc-file-cards">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <div>
                      <strong>{file.name}</strong>
                      <span className={fileProblem(file) ? 'warn-text' : 'muted'}>
                        {formatBytes(file.size)}
                        {fileProblem(file) ? ` · ${fileProblem(file)}` : ''}
                      </span>
                    </div>
                    {!busy && !locked && (
                      <button type="button" className="small" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                        Remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {limits.data && files.length > limits.data.maxBatchFiles && (
              <Feedback error={`Um envio aceita até ${limits.data.maxBatchFiles} arquivos.`} />
            )}
            {limits.data && totalBytes > limits.data.maxBatchMb * 1024 * 1024 && (
              <Feedback error={`O envio ultrapassa ${limits.data.maxBatchMb} MB.`} />
            )}
            <Feedback error={limits.error} />
          </>
        )}

        {step === 1 && (
          <div className="translation-step-fields">
            {protocol.fields}
            <label>
              Nome do envio (opcional)
              <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </label>
            <DocumentCategorySelect
              value={documentCategory}
              onChange={setDocumentCategory}
              categories={categories.data?.categories ?? []}
            />
            <Feedback error={categories.error} />
          </div>
        )}
        {step === 2 && (
          <>
            <div className="filters top-gap">
              {!isDirector && teams.length > 1 && (
                <label className="inline">
                  Equipe
                  <select required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="inline">
                <span>Traduzir de</span>
                <PairSelect value={pair} onChange={setPair} />
              </div>
            </div>
          </>
        )}
        {step === 3 && (
          <div className="translation-send-summary">
            <h4>Confira sua nova tradução</h4>
            <dl>
              <div>
                <dt>Documentos</dt>
                <dd>
                  {files.length} arquivo(s) · {formatBytes(totalBytes)}
                </dd>
              </div>
              <div>
                <dt>Identificação</dt>
                <dd>{name.trim() || 'Sem nome adicional'}</dd>
              </div>
              <div>
                <dt>Protocolo</dt>
                <dd>{protocol.description}</dd>
              </div>
              <div>
                <dt>Tipo e modelo</dt>
                <dd>{categories.data?.categories.find((item) => item.value === documentCategory)?.label ?? 'Automático por documento'}</dd>
              </div>
              <div>
                <dt>Idiomas</dt>
                <dd>{pairLabel(...splitPair(pair))}</dd>
              </div>
              <div>
                <dt>Modalidade</dt>
                <dd>
                  {modeLabel[mode]}
                  {sworn ? ' · tradutor escolhido na conclusão' : ''}
                </dd>
              </div>
              <div>
                <dt>Equipe</dt>
                <dd>{isDirector ? 'Direcionar após o envio' : teams.find((team) => team.id === teamId)?.name}</dd>
              </div>
              <div>
                <dt>Inspeção</dt>
                <dd>{protocol.payload.inspectionMode === 'sample' ? 'Amostra inicial de 10 documentos' : 'Todos os documentos'}</dd>
              </div>
            </dl>
            <details>
              <summary>Arquivos deste envio</summary>
              <ul>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    {file.name} · {formatBytes(file.size)}
                  </li>
                ))}
              </ul>
            </details>
            <p className="muted small-text">
              Ao iniciar, o protocolo e a opção de inspeção serão auditados. Você poderá acompanhar o processamento e conferir o resultado
              na próxima fase.
            </p>
          </div>
        )}
      </fieldset>
      {locked && !busy && (
        <p className="muted small-text">
          A remessa já foi iniciada. Retomar o envio preserva os mesmos arquivos, protocolo e idiomas. Acompanhe recusas e envios pendentes
          em Envios.
        </p>
      )}
      {sending && (
        <p className="muted small-text">
          Enviando: {[...progress.values()].filter((value) => value >= 1).length} de {progress.size} arquivo(s)…
        </p>
      )}
      <Feedback error={error} />
      <div className="actions doc-form-footer">
        {step > 0 && (
          <button type="button" disabled={busy || locked} onClick={() => setStep((current) => current - 1)}>
            Voltar
          </button>
        )}
        {step < 3 ? (
          <button type="button" className="primary" disabled={busy || locked || !nextReady} onClick={advance}>
            Continuar
          </button>
        ) : (
          <button className="primary" disabled={busy || permanentFailure || !readyToSend} onClick={() => void start()}>
            {busy ? 'Enviando…' : locked ? 'Retomar envio' : 'Iniciar tradução'}
          </button>
        )}
        {permanentFailure && createdIds.length > 0 && <button onClick={() => onStarted(createdIds)}>Abrir traduções válidas</button>}
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

type StepState = 'done' | 'current' | 'waiting' | 'failed';

/** Etapas do fluxo automático, do envio ao Word final. */
function flowSteps(t: TranslationSummary) {
  const processing = t.status === 'queued' || t.status === 'processing';
  const steps: Array<[string, StepState, string]> = [
    ['Envio', 'done', 'Documento armazenado'],
    [
      'Tradução',
      t.status === 'failed' ? 'failed' : processing ? 'current' : 'done',
      t.status === 'failed' ? 'Falhou' : processing ? 'Traduzindo no layout do original' : 'Automática',
    ],
    [
      'Revisão',
      processing || t.status === 'failed' ? 'waiting' : 'done',
      processing ? 'Aguardando a tradução' : 'Automática, com correções',
    ],
    [
      'Prévia em Word',
      t.status === 'in_review' ? 'current' : t.status === 'awaiting_approval' || t.status === 'approved' ? 'done' : 'waiting',
      t.status === 'in_review' ? 'Confira e aprove' : t.status === 'approved' || t.status === 'awaiting_approval' ? 'Aprovada' : '—',
    ],
    [
      'Conclusão',
      t.status === 'awaiting_approval' ? 'current' : t.status === 'approved' ? 'done' : 'waiting',
      t.status === 'awaiting_approval' ? 'Com a liderança' : t.status === 'approved' ? (t.number ? `nº ${t.number}` : 'Concluída') : '—',
    ],
    ['Word final', t.status === 'approved' ? 'done' : 'waiting', t.status === 'approved' ? 'Word e PDF liberados' : '—'],
  ];
  return steps;
}

export function FlowTracker({ t }: { t: TranslationSummary }) {
  return (
    <ol className="flow-track doc-flow-track" aria-label="Etapas da tradução">
      {flowSteps(t).map(([label, state, hint]) => (
        <li key={label} className={state}>
          <strong>{label}</strong>
          <span className="small-text">{hint}</span>
        </li>
      ))}
    </ol>
  );
}

/** A linha do fluxo em miniatura, na lista: seis trechos com a etapa atual destacada. O status vai em texto ao lado. */
export function FlowGlyph({ t }: { t: TranslationSummary }) {
  const steps = flowSteps(t);
  return (
    <span className="flow-glyph" aria-hidden="true" title={steps.map(([label, state]) => `${label}: ${stateLabel[state]}`).join(' · ')}>
      {steps.map(([label, state]) => (
        <i key={label} className={state} />
      ))}
    </span>
  );
}

const stateLabel: Record<StepState, string> = { done: 'feita', current: 'agora', waiting: 'a seguir', failed: 'falhou' };

/**
 * O Word na tela (em PDF, como o Word imprime), com os botões de baixar em Word e em PDF. Antes da conclusão é a
 * prévia; depois, o documento final.
 */
export function WordPanel({
  t,
  revision,
  busy,
  onAccept,
  canAccept = true,
}: {
  t: TranslationSummary;
  revision: number | null;
  busy: boolean;
  onAccept: () => void;
  canAccept?: boolean;
}) {
  const final = t.status === 'approved' && t.permissions.download;
  const [showComparison, setShowComparison] = useState(false);
  useEffect(() => setShowComparison(false), [t.id, t.updatedAt, revision]);
  const base = final ? `/api/v1/translations/${t.id}/final` : `/api/v1/translations/${t.id}/preview`;
  // A revisão no endereço força recarregar quando o rascunho muda.
  const pinned = !final && revision ? `&revision=${revision}` : '';
  const pdf = `${base}?format=pdf${pinned}${final ? `#${encodeURIComponent(t.updatedAt)}` : ''}`;
  return (
    <div className="card word-panel doc-domain doc-word-panel">
      <div className="word-head doc-panel-header">
        <div>
          <h3>{final ? 'Tradução final' : 'Prévia em Word'}</h3>
          <span className="muted small-text">
            {final
              ? `${t.number ? `Tradução Pública nº ${t.number} · ` : ''}pronta para entregar`
              : t.status === 'awaiting_approval'
                ? 'Aprovada: aguardando a conclusão pela liderança'
                : t.useMask && t.preferredTranslator
                  ? `Na máscara de ${t.preferredTranslator.name}, com o número previsto`
                  : t.useMask
                    ? 'No layout do original; o tradutor juramentado (opcional) é escolhido na conclusão'
                    : 'Documento traduzido no layout do original'}
          </span>
        </div>
        <div className="actions">
          {!final && (
            <a className="button" href={`${base}?format=docx${pinned}`}>
              Baixar Word
            </a>
          )}
          {!final && (
            <a className="button" href={`${pdf}&download=true`}>
              Baixar PDF
            </a>
          )}
          {t.permissions.accept && (
            <button className="primary" disabled={busy || !canAccept} onClick={onAccept}>
              {t.status === 'awaiting_approval' || t.permissions.approve ? 'Aprovar e concluir' : 'Aprovar Word'}
            </button>
          )}
        </div>
      </div>
      {final && <FinalDelivery translationId={t.id} version={t.updatedAt} batchId={t.batch.id} />}
      {final ? (
        <details open={showComparison} onToggle={(event) => setShowComparison(event.currentTarget.open)}>
          <summary>Comparar documento concluído com o original</summary>
          {showComparison && (
            <DocumentComparison
              originalDocumentId={t.document.id}
              originalName={t.document.name}
              translatedUrl={pdf}
              translatedDownloadUrl={`${base}?format=docx`}
              translatedTitle="Word final"
            />
          )}
        </details>
      ) : (
        <DocumentComparison
          originalDocumentId={t.document.id}
          originalName={t.document.name}
          translatedUrl={pdf}
          translatedDownloadUrl={`${base}?format=docx${pinned}`}
          translatedTitle={final ? 'Word final' : 'Prévia em Word'}
        />
      )}
    </div>
  );
}

/** Comparação com prévias autenticadas e fallback para conferência manual quando a conversão estiver indisponível. */
export function DocumentComparison({
  originalDocumentId,
  originalName,
  translatedUrl,
  translatedDownloadUrl,
  translatedTitle = 'Word traduzido',
}: {
  originalDocumentId: string;
  originalName: string;
  translatedUrl: string;
  translatedDownloadUrl?: string;
  translatedTitle?: string;
}) {
  return (
    <div className="document-comparison doc-comparison">
      <ComparisonPreview
        title={`Original: ${originalName}`}
        url={`/api/v1/documents/${originalDocumentId}/preview`}
        downloadUrl={`/api/v1/documents/${originalDocumentId}/original`}
      />
      <ComparisonPreview title={translatedTitle} url={translatedUrl} downloadUrl={translatedDownloadUrl ?? translatedUrl} />
    </div>
  );
}

function ComparisonPreview({ title, url, downloadUrl }: { title: string; url: string; downloadUrl: string }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setFile(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? 'A visualização não está disponível agora.');
        }
        const blob = await response.blob();
        if (!['application/pdf', 'image/png', 'image/jpeg'].includes(blob.type))
          throw new Error('Este formato exige conferência pelo arquivo original.');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setFile({ url: objectUrl, type: blob.type });
      } catch (caught) {
        if (!controller.signal.aborted) setError(message(caught));
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);
  return (
    <section className="comparison-pane doc-comparison-pane">
      <div className="word-head doc-comparison-header">
        <h4>{title}</h4>
        <a className="button small" href={downloadUrl}>
          Baixar para conferir
        </a>
      </div>
      {error ? (
        <div className="comparison-fallback">
          <Feedback error={error} />
          <p>Baixe este arquivo e confira manualmente antes de registrar a inspeção.</p>
          <button className="small" onClick={() => setAttempt((current) => current + 1)}>
            Tentar prévia novamente
          </button>
        </div>
      ) : !file ? (
        <p className="muted" role="status">
          Preparando visualização…
        </p>
      ) : file.type.startsWith('image/') ? (
        <img className="comparison-image" src={file.url} alt={title} />
      ) : (
        <PdfPreview title={title} url={file.url} />
      )}
    </section>
  );
}

export { ArchiveDownloadButtons } from './ArchiveDownloadButtons';

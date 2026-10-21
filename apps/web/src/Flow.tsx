import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  api,
  formatBytes,
  splitPair,
  uploadContent,
  type Batch,
  type DocumentItem,
  type SwornTranslator,
  type Team,
  type TranslationMode,
  type TranslationSummary,
  type UploadLimits,
} from './api';
import { ModeSelect, PairSelect } from './Modes';
import { Feedback, message, useLoad } from './ui';

/**
 * Fluxo automático (ADR-017): coloca o documento e o sistema traduz, revisa e entrega a prévia em Word; quem aprova
 * leva à próxima fase e o Word final sai em seguida.
 */

const extensionOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

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
  const translators = useLoad(() => api<{ items: SwornTranslator[] }>('GET', '/sworn-translators?active=true'), []);
  const ready = (translators.data?.items ?? []).filter((item) => item.ready);
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0]!.id : '');
  const [pair, setPair] = useState('pt-en');
  const [mode, setMode] = useState<TranslationMode>('sworn');
  const [useMask, setUseMask] = useState(true);
  const [translatorId, setTranslatorId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const sworn = mode === 'sworn';
  const accepted = limits.data?.extensions ?? ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'];

  const add = (list: FileList | null) => {
    const picked = list ? [...list] : [];
    if (picked.length) setFiles((current) => [...current, ...picked.filter((file) => accepted.includes(extensionOf(file.name)))]);
  };

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const [sourceLanguage, targetLanguage] = splitPair(pair);
      const created = await api<{ batch: Batch; documents: DocumentItem[] }>(
        'POST',
        '/batches',
        {
          ...(isDirector ? {} : { teamId }),
          translation: { sourceLanguage, targetLanguage },
          mode,
          ...(sworn ? { useMask } : {}),
          ...(sworn && useMask && translatorId ? { translatorId } : {}),
          files: files.map((file) => ({ name: file.name, size: file.size })),
        },
        { 'Idempotency-Key': idempotencyKey },
      );
      const waiting = created.documents.filter((doc) => doc.status === 'awaiting_upload');
      for (const doc of waiting) {
        const file = files[doc.position]!;
        await uploadContent(doc.id, file, (fraction) => setProgress((current) => new Map(current).set(doc.id, fraction)));
      }
      // Cada documento armazenado entra sozinho na fila; abre as traduções criadas.
      const ids: string[] = [];
      for (const doc of waiting) {
        const found = await api<{ items: TranslationSummary[] }>('GET', `/translations?documentId=${doc.id}&limit=1`);
        if (found.items[0]) ids.push(found.items[0].id);
      }
      onStarted(ids);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  const sending = progress.size > 0;
  return (
    <div className="card new-translation">
      <h3>Nova tradução</h3>
      <p className="muted small-text">
        Coloque o documento: o sistema traduz, revisa e mostra o Word pronto. Você confere e aprova; o Word final sai em seguida.
      </p>
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
        tabIndex={0}
        onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
      >
        <strong>{files.length ? `${files.length} arquivo(s) escolhido(s)` : 'Arraste o documento aqui ou clique para escolher'}</strong>
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
        <ul className="list compact files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <div>
                <strong>{file.name}</strong>
                <span className="muted">{formatBytes(file.size)}</span>
              </div>
              {!busy && (
                <button type="button" className="small" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

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
        <label className="inline">
          Traduzir de
          <PairSelect value={pair} onChange={setPair} />
        </label>
      </div>
      <div className="tags-field">
        <span className="field-label">Modalidade</span>
        <ModeSelect value={mode} onChange={setMode} />
      </div>
      {sworn && (
        <div className="tags-field mask-choice">
          <span className="field-label">Máscara do tradutor</span>
          <div className="mode-options" role="radiogroup" aria-label="Máscara do tradutor">
            <button type="button" role="radio" aria-checked={useMask} className={`mode-option ${useMask ? 'on' : ''}`} onClick={() => setUseMask(true)}>
              <strong>Com máscara</strong>
              <span className="muted small-text">Timbre, abertura e encerramento do tradutor, com número, livro e folha pela regra dele.</span>
            </button>
            <button type="button" role="radio" aria-checked={!useMask} className={`mode-option ${!useMask ? 'on' : ''}`} onClick={() => setUseMask(false)}>
              <strong>Sem máscara</strong>
              <span className="muted small-text">Só o documento traduzido no layout do original, sem tradutor nem numeração.</span>
            </button>
          </div>
          {useMask && (
            <label className="top-gap">
              Tradutor juramentado
              <select value={translatorId} onChange={(e) => setTranslatorId(e.target.value)}>
                <option value="">Escolher depois, na prévia</option>
                {ready.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.languages ? ` (${item.languages})` : ''}
                  </option>
                ))}
              </select>
              {translators.data && !ready.length && (
                <small className="warn-text">Nenhum tradutor com máscara pronta: cadastre em Tradutores juramentados.</small>
              )}
            </label>
          )}
        </div>
      )}
      {sending && (
        <p className="muted small-text">
          Enviando: {[...progress.values()].filter((value) => value >= 1).length} de {progress.size} arquivo(s)…
        </p>
      )}
      <Feedback error={error} />
      <div className="actions">
        <button className="primary" disabled={busy || !files.length || (!isDirector && !teamId)} onClick={() => void start()}>
          {busy ? 'Enviando…' : 'Traduzir'}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

type StepState = 'done' | 'current' | 'waiting' | 'failed';

/** Etapas do fluxo automático, do envio ao Word final. */
export function FlowTracker({ t }: { t: TranslationSummary }) {
  const processing = t.status === 'queued' || t.status === 'processing';
  const steps: Array<[string, StepState, string]> = [
    ['Envio', 'done', 'Documento armazenado'],
    [
      'Tradução',
      t.status === 'failed' ? 'failed' : processing ? 'current' : 'done',
      t.status === 'failed' ? 'Falhou' : processing ? 'Traduzindo no layout do original' : 'Automática',
    ],
    ['Revisão', processing || t.status === 'failed' ? 'waiting' : 'done', processing ? 'Aguardando a tradução' : 'Automática, com correções'],
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
  return (
    <ol className="flow-track" aria-label="Etapas da tradução">
      {steps.map(([label, state, hint]) => (
        <li key={label} className={state}>
          <strong>{label}</strong>
          <span className="small-text">{hint}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * O Word na tela (em PDF, como o Word imprime), com os botões de baixar em Word e em PDF. Antes da conclusão é a
 * prévia; depois, o documento final.
 */
export function WordPanel({
  t,
  revision,
  busy,
  onAccept,
}: {
  t: TranslationSummary;
  revision: number | null;
  busy: boolean;
  onAccept: () => void;
}) {
  const final = t.status === 'approved' && t.permissions.download;
  const base = final ? `/api/v1/translations/${t.id}/final` : `/api/v1/translations/${t.id}/preview`;
  const [failed, setFailed] = useState(false);
  // A revisão no endereço força recarregar quando o rascunho muda.
  const pinned = !final && revision ? `&revision=${revision}` : '';
  const pdf = `${base}?format=pdf${pinned}`;
  return (
    <div className="card word-panel">
      <div className="word-head">
        <div>
          <h3>{final ? 'Tradução final' : 'Prévia em Word'}</h3>
          <span className="muted small-text">
            {final
              ? `${t.number ? `Tradução Pública nº ${t.number} · ` : ''}pronta para entregar`
              : t.status === 'awaiting_approval'
                ? 'Aprovada: aguardando a conclusão pela liderança'
                : t.useMask
                  ? `Na máscara de ${t.preferredTranslator?.name ?? 'tradutor a escolher'}, com o número previsto`
                  : 'Documento traduzido no layout do original'}
          </span>
        </div>
        <div className="actions">
          <a className="button" href={`${base}?format=docx${pinned}`}>
            Baixar Word
          </a>
          <a className="button" href={`${pdf}&download=true`}>
            Baixar PDF
          </a>
          {t.permissions.accept && (
            <button className="primary" disabled={busy} onClick={onAccept}>
              {t.status === 'awaiting_approval' || t.permissions.approve ? 'Aprovar e concluir' : 'Aprovar Word'}
            </button>
          )}
        </div>
      </div>
      {failed ? (
        <p className="muted small-text">A visualização em PDF não está disponível agora; baixe o Word para conferir.</p>
      ) : (
        <iframe key={pdf} className="word-frame" title="Documento em Word" src={pdf} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

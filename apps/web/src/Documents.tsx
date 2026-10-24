import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  api,
  documentStatusLabel,
  errorCodeLabel,
  formatBytes,
  uploadContent,
  type Batch,
  type DocumentItem,
  type DocumentStatus,
  type Me,
  type Page,
  type Team,
  type TranslationStatus,
  type UploadLimits,
  LANGUAGE_PAIRS,
  splitPair,
  modeLabel,
  type TranslationMode,
  type DocumentCategory,
} from './api';
import { ModeSelect, PairSelect } from './Modes';
import { ArchiveDownloadButtons, useBatchProtocol } from './Flow';
import { DocumentTags, StatusBadge } from './Translations';
import { dateTime, Feedback, message, SearchInput, Section, Segmented, TagInput, useDebounced, useLoad } from './ui';
import { useConfirm } from './ConfirmDialog';
import { DocumentCategorySelect, useDocumentCategories } from './DocumentClassification';
import { TranslationSteps } from './TranslationSteps';
import { LanguagePairPicker } from './LanguagePairPicker';

const CONCURRENCY = 3;
/** Formatos aceitos pela tradução juramentada nesta fase (ADR-007). */
const TRANSLATABLE = new Set(['pdf', 'jpeg', 'png', 'docx', 'pptx']);

interface UploadState {
  /** Arquivos ainda na memória desta aba, por documento; permitem reenviar sem escolher de novo. */
  files: Map<string, File>;
  progress: Map<string, number>;
  errors: Map<string, string>;
}

const extensionOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

export function Documents({
  me,
  onOpenTranslation,
  initialSearch = '',
  initialBatchId = null,
}: {
  me: Me;
  onOpenTranslation: (id: string) => void;
  initialSearch?: string;
  initialBatchId?: string | null;
}) {
  const isDirector = me.user.orgRole === 'director';
  const { data: teamsData, error: teamsError, reload: reloadTeams } = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const { data: limits, error: limitsError, reload: reloadLimits } = useLoad(() => api<UploadLimits>('GET', '/batches/limits'), []);
  const [selected, setSelected] = useState<string | null>(initialBatchId);
  useEffect(() => setSelected(initialBatchId), [initialBatchId]);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [uploads, setUploads] = useState<UploadState>({ files: new Map(), progress: new Map(), errors: new Map() });
  const teams = teamsData?.items ?? [];
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const update = (mutate: (state: UploadState) => void) =>
    setUploads((current) => {
      const next = { files: new Map(current.files), progress: new Map(current.progress), errors: new Map(current.errors) };
      mutate(next);
      return next;
    });

  /** Envia os arquivos em paralelo limitado; cada documento termina armazenado, recusado ou reenviável. */
  async function sendAll(entries: Array<[string, File]>) {
    update((state) => entries.forEach(([id, file]) => (state.files.set(id, file), state.errors.delete(id), state.progress.set(id, 0))));
    const queue = [...entries];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const [id, file] = entry;
        try {
          await uploadContent(id, file, (fraction) => update((state) => void state.progress.set(id, fraction)));
          update((state) => (state.files.delete(id), state.progress.delete(id)));
        } catch (caught) {
          update((state) => (state.progress.delete(id), state.errors.set(id, message(caught))));
        }
        refresh();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  // Supervisor e Usuário enviam para a própria equipe; quem envia é o responsável pela tradução.
  const myTeams = teams.filter((team) => team.myRole !== null);
  const hasTeamAccess = isDirector || myTeams.length > 0;
  const prerequisitesReady = !!teamsData && !!limits;
  const canCreate = prerequisitesReady && hasTeamAccess;
  const subtitle =
    teamsError || limitsError
      ? 'Não foi possível carregar os dados necessários ao novo envio.'
      : !prerequisitesReady
        ? 'Carregando equipes e limites de envio…'
        : isDirector
          ? 'Inicie uma nova tradução e direcione os documentos para a equipe responsável.'
          : canCreate
            ? 'Inicie uma nova tradução para a sua equipe e acompanhe o envio e a produção de cada documento.'
            : 'Entre em uma equipe para enviar documentos.';

  return (
    <Section title="Nova tradução" subtitle={subtitle}>
      <div className="doc-domain doc-intake">
        <Feedback error={teamsError ? `Não foi possível carregar suas equipes: ${teamsError}` : null} />
        <Feedback error={limitsError ? `Não foi possível carregar os limites de envio: ${limitsError}` : null} />
        {((!teamsData && !teamsError) || (!limits && !limitsError)) && <p role="status">Carregando dados de envio…</p>}
        {(teamsError || limitsError) && (
          <button
            type="button"
            className="small"
            onClick={() => {
              reloadTeams();
              reloadLimits();
            }}
          >
            Tentar carregar novamente
          </button>
        )}
        {canCreate && !creating && (
          <div className="toolbar doc-primary-toolbar">
            <button className="primary" onClick={() => setCreating(true)}>
              Nova tradução
            </button>
          </div>
        )}
        {creating && prerequisitesReady && limits && (
          <NewBatch
            isDirector={isDirector}
            teams={myTeams}
            limits={limits}
            onCancel={() => setCreating(false)}
            onCreated={(batch, documents, files) => {
              setCreating(false);
              setSelected(batch.id);
              refresh();
              const entries = documents
                .filter((doc) => doc.status === 'awaiting_upload')
                .map((doc) => [doc.id, files[doc.position]!] as [string, File]);
              void sendAll(entries);
            }}
          />
        )}
        {prerequisitesReady && !hasTeamAccess && (
          <p className="empty">Você ainda não participa de equipes. Peça a um Supervisor ou ao Diretor para incluí-lo.</p>
        )}
        <div className="split wide documents-workspace">
          <History
            teams={teams}
            isDirector={isDirector}
            selected={selected}
            onSelect={setSelected}
            version={version}
            initialSearch={initialSearch}
          />
          {selected && (
            <BatchDetail
              key={selected}
              batchId={selected}
              me={me}
              teams={teams}
              uploads={uploads}
              onOpenTranslation={onOpenTranslation}
              version={version}
              onChange={refresh}
              onSend={(entries) => void sendAll(entries)}
            />
          )}
        </div>
      </div>
    </Section>
  );
}

function NewBatch({
  isDirector,
  teams,
  limits,
  onCancel,
  onCreated,
}: {
  isDirector: boolean;
  /** Equipes da pessoa (vazio para o Diretor). */
  teams: Team[];
  limits: UploadLimits;
  onCancel: () => void;
  onCreated: (batch: Batch, documents: DocumentItem[], files: File[]) => void;
}) {
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0]!.id : '');
  const [name, setName] = useState('');
  const [step, setStep] = useState(0);
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory | ''>('');
  const categories = useDocumentCategories();
  // Todo documento armazenado é processado sozinho (ADR-010); o par define os idiomas.
  const [pair, setPair] = useState('pt-en');
  // Modalidade (ADR-015): define as etapas e as regras de tradução do lote.
  const [mode, setMode] = useState<TranslationMode>('sworn');
  const [tags, setTags] = useState<string[]>([]);
  const suggestions = useLoad(() => api<{ items: Array<{ tag: string }> }>('GET', '/tags'), []);
  const [files, setFiles] = useState<File[]>([]);
  const protocol = useBatchProtocol(files.length);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Uma chave por tentativa de criação: um clique repetido ou reenvio da requisição não cria lote duplicado.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const maxFile = limits.maxFileMb * 1024 * 1024;
  const problemOf = (file: File) =>
    !limits.extensions.includes(extensionOf(file.name))
      ? 'Extensão não aceita'
      : file.size === 0
        ? 'Arquivo vazio'
        : file.size > maxFile
          ? `Acima de ${limits.maxFileMb} MB`
          : null;
  const valid = files.filter((file) => !problemOf(file));
  const total = valid.reduce((sum, file) => sum + file.size, 0);
  const tooMany = files.length > limits.maxBatchFiles;
  const tooBig = total > limits.maxBatchMb * 1024 * 1024;
  const filesReady = valid.length > 0 && !tooMany && !tooBig;
  const ready = filesReady && protocol.ready && (isDirector || !!teamId);
  const nextReady = [filesReady, protocol.ready, isDirector || !!teamId, ready][step];
  const advance = () => {
    if (!nextReady || busy) return;
    setError(null);
    setStep((current) => Math.min(current + 1, 3));
  };

  const add = (list: FileList | null) => {
    // Copia já: o FileList é esvaziado quando o campo é limpo, antes de o React aplicar a atualização.
    const picked = list ? [...list] : [];
    if (!picked.length) return;
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...picked.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 3) {
      advance();
      return;
    }
    if (!ready || busy) return;
    if (!protocol.ready) {
      setError('Informe o protocolo ou sua justificativa e escolha a inspeção para remessas grandes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ batch: Batch; documents: DocumentItem[] }>(
        'POST',
        '/batches',
        {
          ...(isDirector ? {} : { teamId }),
          translation: { sourceLanguage: splitPair(pair)[0], targetLanguage: splitPair(pair)[1] },
          mode,
          ...(tags.length ? { tags } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(documentCategory ? { documentCategory } : {}),
          files: files.map((file) => ({ name: file.name, size: file.size })),
          ...protocol.payload,
        },
        { 'Idempotency-Key': idempotencyKey },
      );
      onCreated(result.batch, result.documents, files);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card new-batch doc-form" onSubmit={submit}>
      <h3>Nova tradução</h3>
      <p className="muted small-text">Escolha os documentos, identifique o envio e confira as opções antes de iniciar a tradução.</p>
      <TranslationSteps step={step} onChange={setStep} disabled={busy} />
      <fieldset className="translation-step-fields" disabled={busy}>
        {step === 1 && (
          <>
            {protocol.fields}
            <label>
              Nome do envio (opcional)
              <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <DocumentCategorySelect
              value={documentCategory}
              onChange={setDocumentCategory}
              categories={categories.data?.categories ?? []}
            />
            <Feedback error={categories.error} />
            <fieldset className="tags-field doc-borderless-fields">
              <legend>
                Etiquetas <small className="muted">Opcionais; ajudam a pesquisar e organizar os documentos.</small>
              </legend>
              <TagInput value={tags} onChange={setTags} suggestions={suggestions.data?.items.map((item) => item.tag) ?? []} />
            </fieldset>
          </>
        )}
        {step === 2 && (
          <>
            <div className="filters">
              {isDirector ? (
                <span className="muted small-text">O envio aguardará direcionamento; escolha a equipe após iniciar a tradução.</span>
              ) : teams.length === 1 ? (
                <span className="muted small-text">
                  Equipe: <strong>{teams[0]!.name}</strong>
                </span>
              ) : (
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
            <div className="tags-field">
              <span className="field-label">Modalidade</span>
              <ModeSelect value={mode} onChange={setMode} />
            </div>
          </>
        )}

        {step === 0 && (
          <>
            <div
              className={`dropzone ${dragging ? 'over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
            >
              <strong>Arraste arquivos aqui ou clique para escolher</strong>
              <span className="muted">
                {limits.extensions.map((ext) => ext.toUpperCase()).join(', ')} · até {limits.maxFileMb} MB por arquivo · até{' '}
                {limits.maxBatchFiles} arquivos
              </span>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={limits.extensions.map((ext) => `.${ext}`).join(',')}
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {files.length > 0 && (
              <>
                <div className="count">
                  <span>
                    {files.length} arquivo(s) · {formatBytes(total)} válidos
                    {files.length !== valid.length && ` · ${files.length - valid.length} serão recusados`}
                  </span>
                  <button type="button" className="link" onClick={() => setFiles([])}>
                    Limpar
                  </button>
                </div>
                <ul className="list compact files doc-cards doc-file-cards">
                  {files.map((file, index) => {
                    const problem = problemOf(file);
                    return (
                      <li key={`${file.name}-${index}`}>
                        <div>
                          <strong>{file.name}</strong>
                          <span className={problem ? 'warn-text' : 'muted'}>
                            {formatBytes(file.size)}
                            {problem ? ` · ${problem}` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="small"
                          onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        >
                          Remover
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {tooMany && <Feedback error={`Um envio aceita no máximo ${limits.maxBatchFiles} arquivos.`} />}
            {tooBig && <Feedback error={`O envio passa de ${limits.maxBatchMb} MB.`} />}
          </>
        )}
        {step === 3 && (
          <div className="translation-send-summary">
            <h4>Confira sua nova tradução</h4>
            <dl>
              <div>
                <dt>Documentos</dt>
                <dd>
                  {files.length} arquivo(s) · {formatBytes(total)} válidos
                  {files.length !== valid.length && ` · ${files.length - valid.length} serão recusados`}
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
                <dd>{LANGUAGE_PAIRS.find((item) => item.value === pair)?.label}</dd>
              </div>
              <div>
                <dt>Modalidade</dt>
                <dd>{modeLabel[mode]}</dd>
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
              O protocolo e a opção de inspeção serão registrados na auditoria. Após o envio, acompanhe cada documento abaixo.
            </p>
          </div>
        )}
      </fieldset>
      <Feedback error={error} />
      <div className="actions doc-form-footer">
        {step > 0 && (
          <button type="button" disabled={busy} onClick={() => setStep((current) => current - 1)}>
            Voltar
          </button>
        )}
        {step < 3 ? (
          <button type="button" className="primary" disabled={busy || !nextReady} onClick={advance}>
            Continuar
          </button>
        ) : (
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Iniciando…' : `Iniciar tradução de ${valid.length} arquivo(s)`}
          </button>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function History({
  teams,
  isDirector,
  selected,
  onSelect,
  version,
  initialSearch,
}: {
  teams: Team[];
  isDirector: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  version: number;
  initialSearch: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  const q = useDebounced(search.trim());
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'completed'>('all');
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<Batch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      const params = new URLSearchParams({ limit: '30' });
      if (q) params.set('q', q);
      if (teamId === '__sem_equipe') params.set('unassigned', 'true');
      else if (teamId) params.set('teamId', teamId);
      if (status !== 'all') params.set('status', status);
      if (mine) params.set('mine', 'true');
      if (from) params.set('cursor', from);
      try {
        const page = await api<Page<Batch>>('GET', `/batches?${params}`);
        setItems((current) => (from ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        setError(message(caught));
      }
    },
    [q, teamId, status, mine],
  );

  useEffect(() => {
    void load(null);
  }, [load, version]);

  const filtered = q !== '' || teamId !== '' || status !== 'all' || mine;
  const showTeamFilter = isDirector || teams.length > 1;
  const UNASSIGNED = '__sem_equipe';

  return (
    <div className="stack doc-history">
      <div className="filters doc-filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar protocolo, envio, pessoa ou arquivo" />
        {showTeamFilter && (
          <select aria-label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Todas as equipes</option>
            {isDirector && <option value={UNASSIGNED}>Aguardando direcionamento</option>}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          label="Estado do envio"
          value={status}
          options={[
            ['all', 'Todos'],
            ['open', 'Envio pendente'],
            ['completed', 'Envio concluído'],
          ]}
          onChange={setStatus}
        />
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Só os meus
        </label>
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setTeamId('');
              setStatus('all');
              setMine(false);
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={error} />
      <ul className="list selectable doc-cards doc-batch-cards">
        {items.map((batch) => (
          <li key={batch.id} className={batch.id === selected ? 'selected' : ''} onClick={() => onSelect(batch.id)}>
            <div>
              <strong>
                {batch.protocol ? `${batch.protocol} – ` : ''}
                {batch.name ?? `Tradução de ${dateTime(batch.createdAt)}`}{' '}
                <span className={`badge ${batch.status === 'open' ? 'warn' : ''}`}>
                  {batch.status === 'open' ? 'Envio pendente' : 'Envio concluído'}
                </span>
                {!batch.team && <span className="badge warn">Aguardando direcionamento</span>}
              </strong>
              <span className="muted">
                {batch.team?.name ?? 'Sem equipe'} · {batch.owner.displayName} · {dateTime(batch.createdAt)}
                {batch.translation
                  ? ` · ${batch.mode ? modeLabel[batch.mode].toLowerCase() : 'tradução'} ${batch.translation.sourceLanguage.toUpperCase()} → ${batch.translation.targetLanguage.toUpperCase()}`
                  : ''}
              </span>
              <Progress counts={batch.counts} />
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p className="empty">{filtered ? 'Nenhum envio corresponde aos filtros.' : 'Nenhuma tradução enviada ainda.'}</p>
      )}
      {cursor && (
        <button className="ghost" onClick={() => void load(cursor)}>
          Carregar mais
        </button>
      )}
    </div>
  );
}

function Progress({ counts }: { counts: Batch['counts'] }) {
  const width = (value: number) => `${counts.total ? (value / counts.total) * 100 : 0}%`;
  return (
    <span className="progress-wrap">
      <span className="progress" aria-hidden="true">
        <span className="bar stored" style={{ width: width(counts.stored) }} />
        <span className="bar rejected" style={{ width: width(counts.rejected) }} />
        <span className="bar cancelled" style={{ width: width(counts.cancelled) }} />
      </span>
      <span className="muted small-text">
        {counts.stored}/{counts.total} armazenados
        {counts.pending ? ` · ${counts.pending} pendente(s)` : ''}
        {counts.rejected ? ` · ${counts.rejected} recusado(s)` : ''}
        {counts.cancelled ? ` · ${counts.cancelled} cancelado(s)` : ''}
      </span>
    </span>
  );
}

type DocFilter = 'all' | 'pending' | 'stored' | 'problems';
const PENDING: DocumentStatus[] = ['awaiting_upload', 'uploading', 'upload_failed'];

function BatchDetail({
  batchId,
  me,
  teams,
  uploads,
  onOpenTranslation,
  version,
  onChange,
  onSend,
}: {
  batchId: string;
  me: Me;
  /** Equipes visíveis: todas para o Diretor, as próprias para os demais. */
  teams: Team[];
  uploads: UploadState;
  onOpenTranslation: (id: string) => void;
  version: number;
  onChange: () => void;
  onSend: (entries: Array<[string, File]>) => void;
}) {
  const confirm = useConfirm();
  const { data, error } = useLoad(() => api<{ batch: Batch; documents: DocumentItem[] }>('GET', `/batches/${batchId}`), [batchId, version]);
  const [filter, setFilter] = useState<DocFilter>('all');
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const picker = useRef<HTMLInputElement>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [target, setTarget] = useState('');

  if (!data)
    return <div className="card detail batch-detail">{error ? <Feedback error={error} /> : <p className="muted">Carregando…</p>}</div>;
  const { batch, documents } = data;
  const isOwner = batch.owner.id === me.user.id;
  const isDirector = me.user.orgRole === 'director';
  // Espelha a política da API: cancelar é do Diretor, do Supervisor da equipe do lote e de quem enviou.
  const canCancel =
    isDirector || isOwner || (batch.team !== null && teams.some((team) => team.id === batch.team!.id && team.myRole === 'leader'));
  const docs = documents.filter((doc) =>
    filter === 'all'
      ? true
      : filter === 'pending'
        ? PENDING.includes(doc.status)
        : filter === 'stored'
          ? doc.status === 'stored'
          : doc.status === 'rejected' || doc.status === 'upload_failed' || doc.status === 'cancelled',
  );
  const retryable = documents.filter(
    (doc) => (doc.status === 'awaiting_upload' || doc.status === 'upload_failed') && uploads.files.has(doc.id),
  );
  const hasReadyDocuments = documents.some((document) =>
    document.translations?.some((translation) => translation.status === 'approved' || translation.status === 'awaiting_approval'),
  );

  async function run(label: string, call: () => Promise<unknown>) {
    try {
      await call();
      setFeedback({ ok: label });
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
      onChange();
    }
  }

  return (
    <div className="card detail batch-detail">
      <h3>
        {batch.protocol ? `${batch.protocol} – ` : ''}
        {batch.name ?? `Tradução de ${dateTime(batch.createdAt)}`}
      </h3>
      <p className="muted small-text">
        {batch.team?.name ?? 'Sem equipe'} · enviado por {batch.owner.displayName} · {dateTime(batch.createdAt)} ·{' '}
        {formatBytes(batch.declaredBytes)}
      </p>
      <Progress counts={batch.counts} />
      <p className="muted small-text">
        {batch.protocol
          ? `Protocolo: ${batch.protocol}`
          : batch.protocolOmissionReason
            ? `Sem protocolo: ${batch.protocolOmissionReason}`
            : 'Remessa histórica sem protocolo registrado.'}
      </p>
      <p className="muted small-text">
        Inspeção:{' '}
        {batch.inspectionMode === 'sample'
          ? `amostra inicial de ${batch.inspectionSampleSize} documentos; abra outros individualmente sempre que necessário`
          : 'todos os documentos'}
        . A aprovação exige conferência individual antes da conclusão.
      </p>
      <ArchiveDownloadButtons
        batchId={batch.id}
        disabled={!documents.some((doc) => doc.translations?.some((translation) => translation.status === 'approved'))}
      />

      {isDirector && (
        <div className={`assign ${batch.team ? '' : 'pending'}`}>
          <span>{batch.team ? `Direcionado para ${batch.team.name}` : 'Este envio aguarda direcionamento para uma equipe.'}</span>
          <select aria-label="Equipe de destino" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Escolha a equipe…</option>
            {teams
              .filter((team) => team.id !== batch.team?.id)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
          <button
            className="small primary"
            disabled={!target}
            onClick={async () => {
              if (
                hasReadyDocuments &&
                !(await confirm(
                  'Esta remessa já possui documentos prontos. Tem certeza de que deseja alterar a equipe responsável e os acessos a esses documentos?',
                ))
              )
                return;
              void run(batch.team ? 'Envio redirecionado.' : 'Envio direcionado; a equipe já pode trabalhar nos documentos.', async () => {
                await api('POST', `/batches/${batch.id}/assign`, {
                  teamId: target,
                  ...(hasReadyDocuments ? { confirmCompleted: true } : {}),
                });
                setTarget('');
              });
            }}
          >
            {batch.team ? 'Redirecionar' : 'Direcionar'}
          </button>
        </div>
      )}

      <div className="filters top-gap doc-filter-bar">
        <Segmented
          label="Filtrar documentos"
          value={filter}
          options={[
            ['all', `Todos (${documents.length})`],
            ['pending', `Pendentes (${batch.counts.pending})`],
            ['stored', `Armazenados (${batch.counts.stored})`],
            ['problems', 'Com problema'],
          ]}
          onChange={setFilter}
        />
        {isOwner && retryable.length > 0 && (
          <button className="small primary" onClick={() => onSend(retryable.map((doc) => [doc.id, uploads.files.get(doc.id)!]))}>
            Reenviar {retryable.length} pendente(s)
          </button>
        )}
        {canCancel && batch.counts.pending > 0 && (
          <button className="small danger" onClick={() => run('Pendentes cancelados.', () => api('POST', `/batches/${batch.id}/cancel`))}>
            Cancelar pendentes
          </button>
        )}
      </div>
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />

      <p className="batch-table-hint muted small-text">Deslize a tabela para ver o estado e as ações de cada documento.</p>
      <div className="table-wrap batch-documents-table" role="region" aria-label="Documentos da remessa" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Tamanho</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const progress = uploads.progress.get(doc.id);
              const localError = uploads.errors.get(doc.id);
              const canResend = isOwner && (doc.status === 'awaiting_upload' || doc.status === 'upload_failed') && progress === undefined;
              return (
                <tr key={doc.id}>
                  <td className="name-cell" title={doc.name}>
                    {doc.name}
                    {batch.inspectionMode === 'sample' && doc.position < (batch.inspectionSampleSize ?? 10) && (
                      <span className="badge">Amostra de inspeção</span>
                    )}
                    {doc.status === 'stored' && (
                      <DocumentTags
                        documentId={doc.id}
                        tags={doc.tags}
                        completed={
                          doc.translations?.some(
                            (translation) => translation.status === 'approved' || translation.status === 'awaiting_approval',
                          ) ?? false
                        }
                        onSaved={onChange}
                      />
                    )}
                  </td>
                  <td>{formatBytes(doc.size)}</td>
                  <td>
                    {progress !== undefined ? (
                      <span className="status uploading">Enviando {Math.round(progress * 100)}%</span>
                    ) : (
                      <span className={`status ${doc.status}`}>{documentStatusLabel[doc.status]}</span>
                    )}
                    {(doc.errorCode || localError) && (
                      <span className="reason">{doc.errorCode ? (errorCodeLabel[doc.errorCode] ?? doc.errorCode) : localError}</span>
                    )}
                  </td>
                  <td className="actions">
                    {doc.status === 'stored' && (
                      <a className="button small" href={`/api/v1/documents/${doc.id}/original`} download>
                        Baixar
                      </a>
                    )}
                    {doc.translations?.map((translation) => (
                      <button
                        key={translation.id}
                        className="small"
                        onClick={() => onOpenTranslation(translation.id)}
                        title="Abrir a tradução"
                      >
                        {translation.targetLanguage.toUpperCase()} <StatusBadge status={translation.status as TranslationStatus} />
                      </button>
                    ))}
                    {doc.status === 'stored' && TRANSLATABLE.has(doc.format ?? '') && (
                      <LanguagePairPicker
                        className="small"
                        label="Traduzir"
                        any="Outro idioma…"
                        value=""
                        onChange={async (value) => {
                          const [sourceLanguage, targetLanguage] = value.split('-');
                          if (!sourceLanguage) return;
                          if (
                            doc.translations?.some((translation) => translation.status === 'approved') &&
                            !(await confirm(
                              'Este documento já possui uma tradução pronta. Tem certeza de que deseja criar uma nova tradução em outro idioma?',
                            ))
                          )
                            return;
                          void run('Tradução para o outro idioma iniciada.', async () => {
                            const started = await api<{ translation: { id: string } }>('POST', `/documents/${doc.id}/translations`, {
                              sourceLanguage,
                              targetLanguage,
                              confirmCompleted: true,
                            });
                            onOpenTranslation(started.translation.id);
                          });
                        }}
                      />
                    )}
                    {canResend && (
                      <button
                        className="small"
                        onClick={() => {
                          const file = uploads.files.get(doc.id);
                          if (file) onSend([[doc.id, file]]);
                          else {
                            setPickingFor(doc.id);
                            picker.current?.click();
                          }
                        }}
                      >
                        {doc.status === 'upload_failed' ? 'Reenviar' : 'Enviar'}
                      </button>
                    )}
                    {canCancel && (doc.status === 'awaiting_upload' || doc.status === 'upload_failed') && progress === undefined && (
                      <button
                        className="small danger"
                        onClick={() => run('Documento cancelado.', () => api('POST', `/documents/${doc.id}/cancel`))}
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {docs.length === 0 && <p className="empty">Nenhum documento neste filtro.</p>}
      <input
        ref={picker}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && pickingFor) onSend([[pickingFor, file]]);
          setPickingFor(null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

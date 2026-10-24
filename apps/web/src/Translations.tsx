import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  failureLabel,
  pairLabel,
  queryString,
  translationStatusLabel,
  type DraftContent,
  type AutoReviewResult,
  type Correction,
  type SwornTranslator,
  type Me,
  type Team,
  type TranslationDetail,
  type TranslationFacets,
  type TranslationStatus,
  type TranslationSummary,
  MODES,
  modeLabel,
  type TranslationMode,
  type DocumentCategory,
} from './api';
import { AiAssist } from './AiManagement';
import { DocumentPreview } from './DocumentPreview';
import { FlowTracker, NewTranslation, WordPanel } from './Flow';
import { ModeBadge, StagesPanel } from './Modes';
import { LanguagePairPicker } from './LanguagePairPicker';
import { ArchiveDownloadButtons } from './ArchiveDownloadButtons';
import { DeliveryMenu } from './DeliveryActions';
import { NumberingPanel } from './TranslatorNumbering';
import { useConfirm } from './ConfirmDialog';
import { DocumentClassificationPanel } from './DocumentClassification';
import { DocumentTiming, elapsedLabel, InspectionGate, InspectionHistory, LanguageCorrection, RegisterFormat } from './TranslationWorkflow';
import {
  dateTime,
  DateRange,
  Feedback,
  message,
  PagedFooter,
  SearchInput,
  Section,
  Segmented,
  TagInput,
  TagList,
  useDebounced,
  useLoad,
  usePaged,
} from './ui';

type Tab = 'review' | 'approval' | 'processing' | 'approved' | 'failed' | 'all';
const TAB_STATUS: Record<Tab, TranslationStatus[]> = {
  review: ['in_review'],
  approval: ['awaiting_approval'],
  processing: ['queued', 'processing'],
  approved: ['approved'],
  failed: ['failed'],
  all: [],
};

export function Translations({
  me,
  openId,
  onOpen,
  onGoTranslators,
}: {
  me: Me;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onGoTranslators: () => void;
}) {
  if (openId) return <TranslationView key={openId} id={openId} me={me} onBack={() => onOpen(null)} onGoTranslators={onGoTranslators} />;
  return <TranslationList me={me} onOpen={onOpen} />;
}

/** Fila de trabalho: quem revisa começa em "Para revisar"; quem conclui, em "Aguardando conclusão". */
function TranslationList({ me, onOpen }: { me: Me; onOpen: (id: string) => void }) {
  const isDirector = me.user.orgRole === 'director';
  const approver = isDirector || me.memberships.some((m) => m.role === 'leader');
  const [tab, setTab] = useState<Tab>(approver ? 'approval' : 'review');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [teamId, setTeamId] = useState('');
  const [tag, setTag] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory | ''>('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [pair, setPair] = useState('');
  const [mode, setMode] = useState<TranslationMode | ''>('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [creating, setCreating] = useState(false);
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const myTeams = (teams.data?.items ?? []).filter((team) => team.myRole !== null);
  const canCreate = isDirector || myTeams.length > 0;
  const facets = useLoad(() => api<TranslationFacets>('GET', '/translation-facets'), []);

  const path = `/translations${queryString({
    limit: 30,
    status: TAB_STATUS[tab].join(','),
    q,
    teamId: teamId === '__none' ? undefined : teamId,
    unassigned: teamId === '__none',
    tag,
    documentType,
    documentCategory,
    translationMode: mode || undefined,
    patternKnown: onlyNew ? 'false' : undefined,
    sourceLanguage: pair ? pair.slice(0, 2) : undefined,
    targetLanguage: pair ? pair.slice(3) : undefined,
    createdFrom: period.from,
    createdTo: period.to,
  })}`;
  const list = usePaged<TranslationSummary>(path);
  const [archiveSelection, setArchiveSelection] = useState<Set<string>>(new Set());
  useEffect(() => setArchiveSelection(new Set()), [path]);
  const filtered = !!(q || teamId || tag || documentType || documentCategory || onlyNew || pair || mode || period.from || period.to);
  const clear = () => {
    setSearch('');
    setTeamId('');
    setTag('');
    setDocumentType('');
    setDocumentCategory('');
    setOnlyNew(false);
    setPair('');
    setMode('');
    setPeriod({ from: '', to: '' });
  };

  return (
    <Section title="Traduções" subtitle="Coloque o documento: tradução e revisão são automáticas; você confere o Word e aprova.">
      {canCreate && !creating && (
        <div className="toolbar">
          <button className="primary" onClick={() => setCreating(true)}>
            Nova tradução
          </button>
        </div>
      )}
      {creating && (
        <NewTranslation
          teams={myTeams}
          isDirector={isDirector}
          onCancel={() => setCreating(false)}
          onStarted={(ids) => {
            setCreating(false);
            if (ids.length === 1) onOpen(ids[0]!);
            else {
              setTab('processing');
              list.reload();
            }
          }}
        />
      )}
      <div className="workflow-nav" role="tablist" aria-label="Fases da documentação">
        {(
          [
            ['processing', '1. Produção', 'Recebimento, tradução e revisão automática'],
            ['review', '2. Conferência', 'Compare original e Word; corrija as fases'],
            ['approval', '3. Aprovação', 'Decisão da liderança e numeração'],
            ['approved', '4. Entrega', 'Word, PDF e pacotes ZIP'],
            ['failed', 'Pendências', 'Falhas de processamento que precisam de atenção'],
            ['all', 'Todas', 'Localize qualquer documento ou protocolo'],
          ] as Array<[Tab, string, string]>
        ).map(([key, title, hint]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            <strong>
              {title}{' '}
              {facets.data?.statusCounts && (
                <span className="badge soft">
                  {(key === 'all'
                    ? Object.values(facets.data.statusCounts)
                    : TAB_STATUS[key].map((status) => facets.data!.statusCounts[status] ?? 0)
                  ).reduce((sum, count) => sum + (count ?? 0), 0)}
                </span>
              )}
            </strong>
            <span className="small-text">{hint}</span>
          </button>
        ))}
      </div>
      <div className="filters top-gap">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar protocolo, arquivo, remessa, tipo ou número" />
        {(isDirector || (teams.data?.items.length ?? 0) > 1) && (
          <select aria-label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Todas as equipes</option>
            {isDirector && <option value="__none">Sem equipe (aguardando direcionamento)</option>}
            {teams.data?.items.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Tipo de documento" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {facets.data?.documentTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label="Categoria e modelo documental"
          value={documentCategory}
          onChange={(e) => setDocumentCategory(e.target.value as DocumentCategory | '')}
        >
          <option value="">Todas as categorias e modelos</option>
          {facets.data?.documentCategories?.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label} ({item.count})
            </option>
          ))}
        </select>
        <select aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Todas as etiquetas</option>
          {facets.data?.tags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select aria-label="Modalidade" value={mode} onChange={(e) => setMode(e.target.value as TranslationMode | '')}>
          <option value="">Todas as modalidades</option>
          {MODES.map((value) => (
            <option key={value} value={value}>
              {modeLabel[value]}
            </option>
          ))}
        </select>
        <LanguagePairPicker label="Idiomas" value={pair} onChange={setPair} any="Todos os idiomas" />
        <DateRange label="Recebidas" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        <label className="check">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Só tipos novos
        </label>
        {filtered && (
          <button className="link" onClick={clear}>
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={list.error} />
      {tab === 'approved' && list.items.length > 0 && (
        <details className="card">
          <summary>Baixar documentos concluídos em ZIP ({archiveSelection.size} selecionados)</summary>
          <p>Escolha os documentos abaixo. Eles continuam disponíveis mesmo se você decidir baixar depois.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={list.items.filter((item) => item.permissions.download).every((item) => archiveSelection.has(item.id))}
              onChange={(event) =>
                setArchiveSelection(
                  event.target.checked ? new Set(list.items.filter((item) => item.permissions.download).map((item) => item.id)) : new Set(),
                )
              }
            />
            Selecionar concluídos carregados
          </label>
          <ArchiveDownloadButtons translationIds={[...archiveSelection]} disabled={archiveSelection.size > 100} />
          {archiveSelection.size > 100 && <p className="warn-text">Selecione até 100 documentos por ZIP.</p>}
        </details>
      )}
      <ul className="list selectable work-list">
        {list.items.map((item) => (
          <li key={item.id} onClick={() => onOpen(item.id)}>
            <div>
              <strong>
                {item.batch.protocol && <span className="badge soft">{item.batch.protocol}</span>} {item.document.name}{' '}
                {item.classification && <span className="badge soft">{item.classification.label}</span>}{' '}
                <ModeBadge mode={item.translationMode} /> <StatusBadge status={item.status} />
                {item.patternKnown === false && <span className="badge warn">Tipo novo</span>}
                {!item.assignee && item.status !== 'approved' && <span className="badge info">Sem responsável</span>}
                {item.annulled && <span className="badge danger">Número anulado</span>}
                {item.status !== 'approved' && item.errorCount > 0 && <span className="badge soft">{item.errorCount} a conferir</span>}
              </strong>
              <span className="muted">
                {item.documentType ?? item.sourceTitle ?? 'Tipo ainda não identificado'} ·{' '}
                {pairLabel(item.sourceLanguage, item.targetLanguage)} · {item.team?.name ?? 'Sem equipe'} ·{' '}
                {item.assignee ? `com ${item.assignee.name}` : `enviado por ${item.uploadedBy}`} · {dateTime(item.createdAt)}
                {item.number ? ` · nº ${item.number}` : ''}
              </span>
              {item.timing && (
                <span className="muted small-text">
                  Estimativa: {elapsedLabel(item.timing.estimatedSeconds)} · Sem atividade: {elapsedLabel(item.timing.idleSeconds)}
                  {item.status === 'approved' && !item.timing.firstDownloadedAt
                    ? ` · Pronto sem download há ${elapsedLabel(item.timing.waitingDownloadSeconds)}`
                    : ''}
                </span>
              )}
              {item.reviewLifecycle?.blocked && <span className="badge danger">3 reprovações · novo formato obrigatório</span>}
              <TagList tags={item.document.tags} onPick={setTag} />
            </div>
            {tab === 'approved' && item.permissions.download && (
              <label className="check" onClick={(event) => event.stopPropagation()}>
                <input
                  aria-label={`Incluir ${item.document.name} no ZIP`}
                  type="checkbox"
                  checked={archiveSelection.has(item.id)}
                  onChange={(event) =>
                    setArchiveSelection((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                ZIP
              </label>
            )}
            {item.permissions.download && (
              <DeliveryMenu
                translationId={item.id}
                version={item.updatedAt}
                batchId={item.batch.id}
                original={{ id: item.document.id, name: item.document.name }}
              />
            )}
            <button
              className="small"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(item.id);
              }}
            >
              Abrir
            </button>
          </li>
        ))}
      </ul>
      <PagedFooter
        hasMore={list.hasMore}
        loading={list.loading}
        onMore={list.more}
        empty={list.items.length === 0}
        emptyText={filtered ? 'Nenhuma tradução corresponde aos filtros.' : 'Nada por aqui no momento.'}
      />
    </Section>
  );
}

/** O que a revisão automática corrigiu no documento (ADR-016) e o que ficou para a pessoa. */
function CorrectionsPanel({ corrections, unresolved }: { corrections: Correction[]; unresolved: string[] }) {
  if (!corrections.length && !unresolved.length) return null;
  return (
    <details className="card corrections" open={unresolved.length > 0}>
      <summary>
        Revisão automática: {corrections.length} correção(ões) no documento
        {unresolved.length ? ` · ${unresolved.length} ponto(s) para conferir` : ''}
      </summary>
      {unresolved.length > 0 && (
        <ul className="alert anomalies">
          {unresolved.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <ul className="correction-list">
        {corrections.map((item, index) => (
          <li key={index}>
            <strong>{item.block ? `Bloco ${item.block}` : 'Documento'}:</strong> {item.message}
            <span className="muted small-text block-line">
              <del>{item.before || '—'}</del> → <ins>{item.after}</ins>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function StatusBadge({ status }: { status: TranslationStatus }) {
  const tone =
    status === 'approved'
      ? ''
      : status === 'failed' || status === 'cancelled'
        ? 'danger'
        : status === 'awaiting_approval'
          ? 'info'
          : 'warn';
  return <span className={`badge ${tone}`}>{translationStatusLabel[status]}</span>;
}

type Panel = null | 'conclude' | 'redo' | 'numbering';

function DocumentQuickFacts({ translation: t }: { translation: TranslationSummary }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!t.timing) return null;
  const idle = Math.max(0, (clock - Date.parse(t.timing.lastActivityAt)) / 1000);
  const waiting = t.timing.completedAt ? Math.max(0, (clock - Date.parse(t.timing.completedAt)) / 1000) : null;
  return (
    <div className="document-quick-facts" aria-label="Resumo dos tempos e do tipo documental">
      {t.classification && <span>{t.classification.label}</span>}
      <span>Estimativa: {elapsedLabel(t.timing.estimatedSeconds)}</span>
      <span>Sem atividade: {elapsedLabel(idle)}</span>
      {t.status === 'approved' && !t.timing.firstDownloadedAt && <span>Pronto sem download: {elapsedLabel(waiting)}</span>}
    </div>
  );
}

function TranslationView({ id, me, onBack, onGoTranslators }: { id: string; me: Me; onBack: () => void; onGoTranslators: () => void }) {
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => api<TranslationDetail>('GET', `/translations/${id}`), [id, version]);
  const [draft, setDraft] = useState<DraftContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const [review, setReview] = useState<AutoReviewResult | null>(null);
  const [reviewedComparison, setReviewedComparison] = useState(false);
  const reload = () => setVersion((current) => current + 1);

  // Ao (re)carregar, descarta edições locais da revisão anterior.
  useEffect(() => {
    setDraft(data?.draft?.content ?? null);
  }, [data]);
  useEffect(() => setReviewedComparison(false), [data?.draft?.revision]);

  // Enquanto processa, a tela se atualiza sozinha.
  const status = data?.translation.status;
  useEffect(() => {
    if (status !== 'queued' && status !== 'processing') return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [status]);

  const dirty = useMemo(() => !!data?.draft && JSON.stringify(draft) !== JSON.stringify(data.draft.content), [draft, data]);

  if (!data) return <Section title="Tradução">{error ? <Feedback error={error} /> : <p className="muted">Carregando…</p>}</Section>;
  const { translation: t, frame } = data;
  const errors = data.draft?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = data.draft?.issues.filter((issue) => issue.severity === 'warning') ?? [];
  const isDirector = me.user.orgRole === 'director';
  const sampleExempt = t.batch.inspectionMode === 'sample' && !t.reviewLifecycle?.isSampleDocument && t.reviewLifecycle?.sampleCovered;

  async function inspectBeforeApproval() {
    if (!data?.draft) return false;
    if (sampleExempt) return true;
    if (!reviewedComparison) {
      setFeedback({ error: 'Compare o original e o Word e confirme a conferência antes de aprovar.' });
      return false;
    }
    await api('POST', `/translations/${id}/inspections`, {
      decision: 'approved',
      baseRevision: data.draft.revision,
      failedStages: [],
      scope: t.batch.inspectionMode ?? 'all',
    });
    return true;
  }

  async function run<T>(label: string, call: () => Promise<T>) {
    setBusy(true);
    setFeedback({});
    try {
      const result = await call();
      setFeedback({ ok: label });
      return result;
    } catch (caught) {
      setFeedback({ error: message(caught) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function claimDocument() {
    const completed = t.status === 'awaiting_approval';
    if (completed && !(await confirm('Este documento já está pronto. Deseja assumir sua responsabilidade?'))) return;
    const result = await run('Agora esta tradução é sua.', () => api('POST', `/translations/${id}/claim`, { confirmCompleted: completed }));
    if (result) reload();
  }

  /** Grava as edições como nova revisão; devolve `false` se não conseguiu. */
  async function save() {
    if (!dirty || !draft || !data?.draft) return true;
    const saved = await run('Alterações salvas.', () =>
      api<{ revision: number }>('PUT', `/translations/${id}/draft`, { baseRevision: data.draft!.revision, draft }),
    );
    if (saved) {
      setEditing(false);
      reload();
    }
    return !!saved;
  }

  async function autoReviewNow() {
    if (!(await save())) return;
    const result = await run('Revisão automática concluída.', () => api<AutoReviewResult>('POST', `/translations/${id}/auto-review`));
    if (result) {
      setReview(result);
      setFeedback({
        ok: result.corrections.length
          ? `Revisão automática: ${result.corrections.length} correção(ões) aplicada(s) ao documento.`
          : 'Revisão automática: nada a corrigir.',
      });
      reload();
    }
  }

  async function acceptWord() {
    if (dirty || (!sampleExempt && !reviewedComparison)) {
      setFeedback({ error: 'Salve as alterações e confirme a comparação do original com o Word antes de aprovar.' });
      return;
    }
    const done = await run('Aprovado: a tradução seguiu para a próxima fase.', () =>
      inspectBeforeApproval().then((inspected) => (inspected ? api<TranslationDetail>('POST', `/translations/${id}/accept`) : undefined)),
    );
    if (done) {
      setFeedback({
        ok:
          done.translation.status === 'approved'
            ? 'Concluída: o Word final e o PDF estão liberados.'
            : 'Aprovado: a liderança da equipe foi avisada para concluir.',
      });
      reload();
    }
  }

  async function ready() {
    if (dirty) {
      if (await save()) setFeedback({ ok: 'Alterações salvas. Confira a nova prévia e o original antes de aprovar.' });
      return;
    }
    if (!(await save())) return;
    if (!sampleExempt && !reviewedComparison) {
      setFeedback({ error: 'Confira o Word e o original após salvar, antes de marcar como pronta.' });
      return;
    }
    const done = await run('Marcada como pronta: a liderança foi avisada para concluir.', () =>
      inspectBeforeApproval().then((inspected) => (inspected ? api('POST', `/translations/${id}/submit`) : undefined)),
    );
    if (done) reload();
  }

  return (
    <section className="section review">
      <div className="review-top">
        <button className="ghost small" onClick={onBack}>
          ← Traduções
        </button>
        <div className="review-title">
          <h2>
            {t.batch.protocol ? `${t.batch.protocol} – ` : ''}
            {t.document.name}
          </h2>
          <p className="muted small-text">
            <StatusBadge status={t.status} /> {t.documentType ?? t.sourceTitle ?? 'Tipo ainda não identificado'} ·{' '}
            {pairLabel(t.sourceLanguage, t.targetLanguage)} · {t.team?.name ?? 'Sem equipe'} · enviado por {t.uploadedBy} em{' '}
            {dateTime(t.createdAt)}
            {t.number ? ` · Tradução Pública nº ${t.number}` : ''}
            {t.translator
              ? ` · ${t.translator.name}${t.translator.maskEdition ? ` (máscara, edição ${t.translator.maskEdition})` : ''}`
              : ''}
          </p>
          <p className="small-text">
            Responsável:{' '}
            {t.assignee ? <strong>{t.assignee.name}</strong> : <span className="muted">ninguém ainda — a equipe pode assumir</span>}
            {t.assignee?.id === me.user.id ? ' (você)' : ''}
          </p>
          <DocumentTags
            documentId={t.document.id}
            tags={t.document.tags}
            completed={t.status === 'approved' || t.status === 'awaiting_approval'}
            onSaved={reload}
          />
        </div>
      </div>

      <FlowTracker t={t} />
      {t.annulled && (
        <p className="alert error">
          <strong>Número anulado</strong> em {dateTime(t.annulled.at)}: {t.annulled.reason}. O número continua registrado no livro e não é
          reutilizado; a tradução não vale mais.
        </p>
      )}
      {t.pendingNumberingRequest && (
        <p className="alert info">Há um pedido de alteração ou anulação deste número aguardando decisão (veja em Numeração).</p>
      )}
      {t.status === 'failed' && (
        <p className="alert error">Falha no processamento: {failureLabel[t.failureCode ?? ''] ?? t.failureCode ?? 'erro desconhecido'}.</p>
      )}
      {t.reviewComment && t.status === 'in_review' && (
        <p className="alert warn-box">
          <strong>Pedido para refazer:</strong> {t.reviewComment}
        </p>
      )}
      {t.patternKnown === false && t.status !== 'approved' && (
        <p className="alert warn-box">
          <strong>Tipo de documento novo.</strong> Confira com atenção: ainda não há tradução concluída desse tipo para usar como
          referência.
        </p>
      )}
      {t.permissions.claim && (
        <div className="toolbar">
          <button className="primary" disabled={busy} onClick={() => void claimDocument()}>
            Assumir documento para conferir
          </button>
        </div>
      )}
      <DocumentQuickFacts translation={t} />
      <details className="card secondary-options document-options">
        <summary>Dados e opções do documento</summary>
        <p className="muted small-text">
          Consulte os tempos completos, corrija o tipo ou os idiomas e acompanhe o histórico de conferências.
        </p>
        <DocumentTiming translation={t} />
        <DocumentClassificationPanel
          key={`${id}-${t.classification?.category}-${t.classification?.correctedAt}`}
          translation={t}
          onSaved={reload}
        />
        <LanguageCorrection key={`${id}-${t.sourceLanguage}-${t.targetLanguage}`} t={t} me={me} onDone={reload} />
        <InspectionHistory items={data.inspections ?? []} />
      </details>
      {(t.status === 'queued' || t.status === 'processing') && (
        <p className="alert info">Traduzindo e revisando o documento… esta tela se atualiza sozinha e a prévia em Word aparece aqui.</p>
      )}
      {t.useMask && (t.status === 'in_review' || t.status === 'awaiting_approval') && (
        <NumberingPanel
          key={`${id}-${t.status}-numbering`}
          translationId={id}
          editable={t.permissions.edit || t.permissions.approve}
          canAuthorize={t.permissions.approve}
          defaultTranslatorId={t.preferredTranslator?.id ?? null}
          defaultPages={t.pageCount}
          completed={t.status === 'awaiting_approval'}
          onSaved={() => {
            setReviewedComparison(false);
            reload();
          }}
        />
      )}
      {data.draft &&
        (t.status === 'in_review' || t.status === 'awaiting_approval' || (t.status === 'approved' && t.permissions.download)) && (
          <WordPanel
            t={t}
            revision={data.draft.revision}
            busy={busy || dirty}
            canAccept={!!sampleExempt || reviewedComparison}
            onAccept={() => void acceptWord()}
          />
        )}
      {data.draft && (t.status === 'in_review' || t.status === 'awaiting_approval') && (
        <InspectionGate
          t={t}
          revision={data.draft.revision}
          reviewed={reviewedComparison}
          onReviewed={setReviewedComparison}
          busy={busy || dirty}
          onDone={reload}
        />
      )}
      {draft && data.draft && (
        <RegisterFormat
          t={t}
          revision={data.draft.revision}
          draft={draft}
          onDraft={setDraft}
          onEdit={() => setEditing(true)}
          onDone={() => {
            setEditing(false);
            setReviewedComparison(false);
            reload();
          }}
        />
      )}
      {/* Auxílio da IA (ADR-021) junto da prévia: a sugestão de diagramação pendente aparece aberta. */}
      {data.draft && !editing && <AiAssist translationId={id} status={t.status} onApplied={reload} />}
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      {data.draft && t.status !== 'approved' && (errors.length > 0 || warnings.length > 0) && (
        <details className="checks" open={errors.length > 0}>
          <summary>
            {errors.length ? `${errors.length} ponto(s) para conferir` : 'Nenhum problema'}
            {warnings.length ? ` · ${warnings.length} aviso(s)` : ''}
          </summary>
          <ul>
            {errors.map((issue, index) => (
              <li key={`e${index}`} className="error-text">
                {issue.message}
              </li>
            ))}
            {warnings.map((issue, index) => (
              <li key={`w${index}`} className="muted">
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="card manual-tools" open={editing}>
        <summary>Ajustes manuais (opcional): texto, checklist, revisão e conclusão com outro tradutor</summary>
        <div className="action-bar">
          {t.permissions.claim && (
            <button className="primary" disabled={busy} onClick={() => void claimDocument()}>
              Assumir
            </button>
          )}
          {t.permissions.reassign && t.team && (
            <ReassignControl
              teamId={t.team.id}
              current={t.assignee?.id ?? null}
              id={id}
              completed={t.status === 'approved' || t.status === 'awaiting_approval'}
              onDone={reload}
            />
          )}
          {(t.permissions.edit || t.permissions.registerNewFormat) && !editing && (
            <button onClick={() => setEditing(true)} disabled={busy}>
              Editar texto
            </button>
          )}
          {editing && (
            <>
              <button className="primary" onClick={() => void save()} disabled={busy || !dirty || t.reviewLifecycle?.blocked}>
                Salvar alterações
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setDraft(data.draft?.content ?? null);
                  setEditing(false);
                }}
              >
                Descartar
              </button>
            </>
          )}
          {t.permissions.edit && t.status === 'in_review' && !editing && (
            <button onClick={() => void autoReviewNow()} disabled={busy} title="Corrige idioma, números, datas, glossário e marcadores">
              Revisão automática
            </button>
          )}
          {t.permissions.submit && dirty && (
            <button className="primary" onClick={() => void ready()} disabled={busy}>
              Salvar e voltar à conferência
            </button>
          )}
          {t.permissions.approve && (
            <button
              className={t.status === 'awaiting_approval' ? 'primary' : ''}
              onClick={() => setPanel(panel === 'conclude' ? null : 'conclude')}
            >
              Concluir
            </button>
          )}
          {(t.permissions.returnForChanges || (t.permissions.reprocess && t.status === 'in_review')) && (
            <button onClick={() => setPanel(panel === 'redo' ? null : 'redo')}>Refazer…</button>
          )}
          {t.permissions.reprocess && t.status === 'failed' && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run('Documento voltou para a fila.', () => api('POST', `/translations/${id}/reprocess`)).then(reload)}
            >
              Processar de novo
            </button>
          )}
          {t.permissions.requestNumbering && (
            <button onClick={() => setPanel(panel === 'numbering' ? null : 'numbering')}>Alterar ou anular número…</button>
          )}
          <span className="spacer" />
          {data.draft && !t.permissions.download && (
            <a className="button" href={`/api/v1/translations/${id}/preview`}>
              Baixar prévia (DOCX)
            </a>
          )}
          <a className="button" href={`/api/v1/documents/${t.document.id}/original`}>
            Baixar original
          </a>
        </div>

        <CorrectionsPanel corrections={data.draft?.corrections ?? []} unresolved={review?.unresolved ?? []} />
        {panel === 'conclude' && (
          <ConcludePanel
            id={id}
            errors={errors.length}
            canManageTranslators={me.memberships.some((m) => m.role === 'leader')}
            sworn={t.useMask}
            dirty={dirty}
            beforeConclude={inspectBeforeApproval}
            compared={!!sampleExempt || reviewedComparison}
            onGoTranslators={onGoTranslators}
            onDone={() => {
              setPanel(null);
              setFeedback({ ok: 'Tradução concluída: o download está liberado.' });
              reload();
            }}
          />
        )}
        {panel === 'numbering' && (
          <NumberingRequestPanel
            id={id}
            onDone={() => {
              setPanel(null);
              setFeedback({ ok: 'Pedido enviado: o Supervisor da equipe e o Diretor foram avisados.' });
              reload();
            }}
          />
        )}
        {panel === 'redo' && (
          <RedoPanel
            id={id}
            canReturn={t.permissions.returnForChanges}
            revision={data.draft?.revision ?? 0}
            inspectionScope={t.batch.inspectionMode ?? 'all'}
            completed={t.status === 'awaiting_approval'}
            onDone={(text) => {
              setPanel(null);
              setFeedback({ ok: text });
              reload();
            }}
          />
        )}

        {(t.status === 'in_review' || t.status === 'awaiting_approval') && (
          <StagesPanel
            translationId={id}
            stages={t.stages}
            checklist={data.checklist}
            editable={t.permissions.edit || t.permissions.approve}
            completed={t.status === 'awaiting_approval'}
            onChange={reload}
          />
        )}
        {t.useMask && t.status === 'approved' && (
          <NumberingPanel key={`${id}-${t.status}`} translationId={id} editable={false} canAuthorize={false} />
        )}

        {t.notice && t.status !== 'approved' && <p className="muted small-text">{t.notice}</p>}

        {editing && (
          <p className="muted small-text">
            Clique no texto para editar. Passe o mouse para ver o original. Enter confirma; Shift+Enter quebra a linha.
          </p>
        )}
        {draft ? (
          <DocumentPreview
            frame={frame}
            draft={draft}
            highlightUntranslated={t.status !== 'approved'}
            {...(editing ? { onChange: setDraft } : {})}
          />
        ) : (
          t.status !== 'queued' && t.status !== 'processing' && <p className="empty">Ainda não há rascunho para este documento.</p>
        )}
      </details>
    </section>
  );
}

/** Reatribuir a alguém da equipe (Supervisor e Diretor). */
function ReassignControl({
  teamId,
  current,
  id,
  completed,
  onDone,
}: {
  teamId: string;
  current: string | null;
  id: string;
  completed: boolean;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const members = useLoad(
    () => api<{ items: Array<{ userId: string; displayName: string; role: string }> }>('GET', `/teams/${teamId}/members`),
    [teamId],
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        aria-label="Reatribuir"
        value=""
        onChange={async (e) => {
          const userId = e.target.value;
          if (!userId) return;
          if (
            completed &&
            !(await confirm('Este documento já está pronto. Tem certeza de que deseja mudar o responsável? A alteração será auditada.'))
          )
            return;
          api('PUT', `/translations/${id}/assignee`, { userId, ...(completed ? { confirmCompleted: true } : {}) })
            .then(onDone)
            .catch((caught: unknown) => setError(message(caught)));
        }}
      >
        <option value="">Reatribuir…</option>
        {members.data?.items
          .filter((member) => member.userId !== current)
          .map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
      </select>
      {error && <span className="error-text small-text">{error}</span>}
    </>
  );
}

/** Pedido de alteração (livro, folha ou número) ou anulação do número; decide o Supervisor da equipe ou o Diretor. */
function NumberingRequestPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const confirm = useConfirm();
  const [kind, setKind] = useState<'change' | 'annul'>('change');
  const [reason, setReason] = useState('');
  const [values, setValues] = useState({ number: '', book: '', sheet: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value.trim() !== '')
      .map(([key, value]) => [key, value.trim().slice(0, 40)]),
  );
  // Número, livro e folha em texto, no formato do tradutor (ADR-012).
  const invalid = reason.trim().length < 5 || (kind === 'change' && Object.keys(parsed).length === 0);

  async function send() {
    if (
      !(await confirm(
        'Tem certeza de que deseja pedir a alteração ou anulação da numeração deste documento concluído? O pedido e sua justificativa ficarão registrados.',
      ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/translations/${id}/numbering-requests`, { kind, reason: reason.trim(), ...(kind === 'change' ? parsed : {}) });
      onDone();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <h3>Alterar ou anular o número</h3>
      <p className="muted">
        O pedido vai para o Supervisor da equipe, que autoriza ou recusa; o Diretor é avisado e pode reverter. Um número anulado continua no
        livro e não é reutilizado.
      </p>
      <Segmented
        label="Pedido"
        value={kind}
        options={[
          ['change', 'Corrigir número, livro ou folha'],
          ['annul', 'Anular o número'],
        ]}
        onChange={setKind}
      />
      {kind === 'change' && (
        <div className="field-row">
          {(['number', 'book', 'sheet'] as const).map((key) => (
            <label key={key}>
              {key === 'number' ? 'Número correto' : key === 'book' ? 'Livro correto' : 'Folha correta'}
              <input
                maxLength={40}
                placeholder="manter"
                value={values[key]}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      <label>
        Motivo
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: folha registrada errada no livro."
        />
      </label>
      <Feedback error={error} />
      <div className="actions">
        <button className="primary" disabled={busy || invalid} onClick={() => void send()}>
          {busy ? 'Enviando…' : 'Enviar pedido'}
        </button>
      </div>
    </div>
  );
}

/**
 * Conclusão (ADR-012): escolhe o tradutor juramentado (a máscara dele) e digita o número, o livro e a folha conforme as
 * regras dele. A prévia na máscara escolhida pode ser baixada antes de concluir.
 */
function ConcludePanel({
  id,
  errors,
  canManageTranslators,
  sworn,
  dirty,
  beforeConclude,
  compared,
  onGoTranslators,
  onDone,
}: {
  id: string;
  errors: number;
  canManageTranslators: boolean;
  /** Só a juramentada precisa do tradutor juramentado e da máscara (ADR-015). */
  sworn: boolean;
  dirty: boolean;
  beforeConclude: () => Promise<boolean>;
  compared: boolean;
  onGoTranslators: () => void;
  onDone: () => void;
}) {
  const translators = useLoad(() => api<{ items: SwornTranslator[] }>('GET', '/sworn-translators?active=true'), []);
  const ready = (translators.data?.items ?? []).filter((item) => item.ready);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sworn && translators.data && ready.length === 0) {
    return (
      <div className="card panel">
        <h3>Falta cadastrar um tradutor juramentado</h3>
        <p className="muted">
          A tradução concluída sai na máscara em Word do tradutor juramentado, com o número dele. Cadastre o tradutor e envie a máscara
          antes da primeira conclusão.
        </p>
        {canManageTranslators ? (
          <button className="primary" onClick={onGoTranslators}>
            Cadastrar tradutor
          </button>
        ) : (
          <p className="alert warn-box">Peça a um Supervisor para cadastrar o tradutor juramentado e a máscara dele.</p>
        )}
      </div>
    );
  }

  async function conclude() {
    setBusy(true);
    setError(null);
    try {
      if (!(await beforeConclude())) return;
      // A numeração preenchida no painel "Numeração" é conferida de novo e emitida agora (ADR-014).
      await api('POST', `/translations/${id}/approve`, errors ? { overrideReason: reason.trim() } : {});
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <h3>Concluir tradução</h3>
      <p className="muted">
        A numeração preenchida abaixo é conferida pela regra do tradutor e emitida; o documento entra na máscara dele, o DOCX final é gerado
        e o download é liberado. Quem enviou e quem revisou são avisados.
      </p>
      {dirty && <p className="alert warn-box">Há alterações não salvas no texto; salve antes de concluir.</p>}
      {errors > 0 && (
        <label>
          Ainda há {errors} ponto(s) para conferir. Justifique para concluir assim mesmo:
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: número conferido no original." />
        </label>
      )}
      <Feedback error={error ?? translators.error} />
      <div className="actions">
        <button
          className="primary"
          disabled={busy || dirty || !compared || (errors > 0 && reason.trim().length < 10)}
          onClick={() => void conclude()}
        >
          {busy ? 'Concluindo…' : 'Concluir e liberar download'}
        </button>
      </div>
    </div>
  );
}

function RedoPanel({
  id,
  canReturn,
  revision,
  inspectionScope,
  completed,
  onDone,
}: {
  id: string;
  canReturn: boolean;
  revision: number;
  inspectionScope: 'all' | 'sample';
  completed: boolean;
  onDone: (message: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [reprocess, setReprocess] = useState(!canReturn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStages, setFailedStages] = useState<string[]>([]);
  const confirm = useConfirm();

  async function send() {
    if (
      completed &&
      !(await confirm('Este documento já está pronto. Deseja devolvê-lo para correção? Será necessária uma nova conferência e aprovação.'))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/translations/${id}/inspections`, {
        decision: 'rejected',
        baseRevision: revision,
        failedStages,
        scope: inspectionScope,
        ...(completed ? { confirmCompleted: true } : {}),
        comment: comment.trim(),
        reprocess,
      });
      onDone(reprocess ? 'O documento será processado de novo; a equipe foi avisada.' : 'Devolvida para a equipe com o motivo.');
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <h3>Refazer</h3>
      <fieldset>
        <legend>Fases com falha</legend>
        {[
          ['correction', 'Correção'],
          ['translation', 'Tradução'],
          ['layout', 'Diagramação'],
          ['review', 'Revisão'],
        ].map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={failedStages.includes(key!)}
              onChange={(e) =>
                setFailedStages((current) => (e.target.checked ? [...current, key!] : current.filter((value) => value !== key)))
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        O que precisa ser refeito?
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex.: conferir as notas da 3ª série." />
      </label>
      <label className="check">
        <input type="checkbox" checked={reprocess} disabled={!canReturn} onChange={(e) => setReprocess(e.target.checked)} />
        Processar o documento de novo (útil depois de ajustar o glossário); a versão atual fica no histórico
      </label>
      <Feedback error={error} />
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !revision || !failedStages.length || comment.trim().length < 3}
          onClick={() => void send()}
        >
          {busy ? 'Enviando…' : reprocess ? 'Reprocessar e avisar a equipe' : 'Devolver para a equipe'}
        </button>
      </div>
    </div>
  );
}

/** Etiquetas do documento, editáveis por quem trabalha com ele. */
export function DocumentTags({
  documentId,
  tags,
  completed = false,
  onSaved,
}: {
  documentId: string;
  tags: string[];
  completed?: boolean;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tags);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useLoad(
    () => (editing ? api<{ items: Array<{ tag: string }> }>('GET', '/tags') : Promise.resolve({ items: [] })),
    [editing],
  );

  if (!editing) {
    return (
      <span className="tag-line">
        <TagList tags={tags} />
        <button className="link small-text" onClick={() => (setValue(tags), setEditing(true))}>
          {tags.length ? 'editar etiquetas' : 'adicionar etiquetas'}
        </button>
      </span>
    );
  }
  return (
    <div className="tag-edit">
      <TagInput value={value} onChange={setValue} suggestions={suggestions.data?.items.map((item) => item.tag) ?? []} />
      <button
        className="small primary"
        onClick={async () => {
          if (
            completed &&
            !(await confirm('Este documento está pronto. Tem certeza de que deseja alterar as etiquetas? A mudança ficará na auditoria.'))
          )
            return;
          void api('PUT', `/documents/${documentId}/tags`, { tags: value, ...(completed ? { confirmCompleted: true } : {}) })
            .then(() => {
              setEditing(false);
              onSaved();
            })
            .catch((caught: unknown) => setError(message(caught)));
        }}
      >
        Salvar
      </button>
      <button className="small ghost" onClick={() => setEditing(false)}>
        Cancelar
      </button>
      <Feedback error={error} />
    </div>
  );
}

export type UserStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type OrgRole = 'director' | 'member';
export type TeamRole = 'leader' | 'operator';

export interface User {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  orgRole: OrgRole;
  createdAt: string;
  /** Conta criada como teste na configuração inicial: pode ser excluída. */
  testAccount: boolean;
}

export interface Membership {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

export interface Me {
  user: User;
  memberships: Membership[];
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  myRole: TeamRole | null;
}

export interface TeamMember {
  userId: string;
  email: string;
  displayName: string;
  status: UserStatus;
  role: TeamRole;
  addedAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface AuditEvent {
  severity: 'info' | 'warning' | 'error' | 'critical';
  failureCode: string | null;
  id: string;
  occurredAt: string;
  actor: { id: string; displayName: string | null } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  team: { id: string; name: string } | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | undefined;

/** Chamado quando uma requisição autenticada recebe 401 (sessão expirada ou revogada). */
export const setUnauthorizedHandler = (handler: (() => void) | undefined) => {
  unauthorizedHandler = handler;
  return () => {
    unauthorizedHandler = undefined;
  };
};

/** Chamada à API na mesma origem (proxy do Vite). Cookie de sessão é HttpOnly; o cliente nunca vê o token. */
export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedHandler?.();
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'Falha na comunicação com o servidor');
  }
  return data as T;
}

export type DocumentStatus = 'awaiting_upload' | 'uploading' | 'stored' | 'rejected' | 'upload_failed' | 'cancelled';

export interface DocumentItem {
  id: string;
  batchId: string;
  position: number;
  name: string;
  extension: string;
  size: number;
  status: DocumentStatus;
  format: string | null;
  sha256: string | null;
  errorCode: string | null;
  tags: string[];
  storedAt: string | null;
  updatedAt: string;
  /** Traduções do documento (presentes no detalhe do lote). */
  translations?: Array<{ id: string; targetLanguage: Language; status: string }>;
}

/** Documento enviado com as traduções geradas a partir dele (busca de documentos e área de downloads). */
export interface DocumentSearchItem extends Omit<DocumentItem, 'translations'> {
  batch: {
    id: string;
    name: string | null;
    protocol?: string | null;
    inspectionMode?: 'all' | 'sample';
    inspectionSampleSize?: number | null;
  };
  team: { id: string; name: string } | null;
  uploadedBy: { id: string; displayName: string };
  translations: Array<{
    id: string;
    sourceLanguage: Language;
    targetLanguage: Language;
    status: TranslationStatus;
    number: string | null;
    documentType: string | null;
    approvedAt: string | null;
  }>;
}

export interface Batch {
  id: string;
  name: string | null;
  protocol: string | null;
  protocolOmissionReason: string | null;
  inspectionMode: 'all' | 'sample';
  inspectionSampleSize: number | null;
  /** `null` enquanto o lote do Diretor aguarda direcionamento. */
  team: { id: string; name: string } | null;
  assignedAt: string | null;
  /** Par de idiomas do processamento automático; `null` só em lotes antigos. */
  translation: { sourceLanguage: Language; targetLanguage: Language } | null;
  mode?: TranslationMode;
  useMask?: boolean;
  translator?: { id: string; name: string } | null;
  owner: { id: string; displayName: string };
  declaredBytes: number;
  createdAt: string;
  status: 'open' | 'completed';
  counts: { total: number; stored: number; pending: number; rejected: number; cancelled: number };
}

export interface UploadLimits {
  maxFileMb: number;
  maxBatchFiles: number;
  maxBatchMb: number;
  extensions: string[];
}

/**
 * Envia o conteúdo bruto de um documento com progresso (XHR, já que fetch não informa progresso de envio).
 * Resolve com o documento atualizado ou rejeita com ApiError.
 */
export function uploadContent(documentId: string, file: Blob, onProgress: (fraction: number) => void): Promise<DocumentItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/v1/documents/${documentId}/content`);
    xhr.setRequestHeader('X-CSRF-Protection', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Conexão interrompida; tente novamente'));
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return undefined;
        }
      })();
      if (xhr.status === 401) unauthorizedHandler?.();
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data.document as DocumentItem);
      reject(new ApiError(xhr.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Falha no envio'));
    };
    xhr.send(file);
  });
}

export const documentStatusLabel: Record<DocumentStatus, string> = {
  awaiting_upload: 'Aguardando envio',
  uploading: 'Enviando',
  stored: 'Armazenado',
  rejected: 'Recusado',
  upload_failed: 'Falhou (reenviável)',
  cancelled: 'Cancelado',
};

/** Mensagens dos motivos de recusa/falha definidos no ADR-006. */
export const errorCodeLabel: Record<string, string> = {
  unsupported_extension: 'Extensão não aceita',
  empty: 'Arquivo vazio',
  too_large: 'Acima do limite de tamanho',
  size_mismatch: 'Tamanho diferente do declarado',
  unknown_format: 'Formato não reconhecido',
  protected_or_legacy: 'Protegido por senha ou formato antigo (.doc/.ppt)',
  invalid_archive: 'Arquivo corrompido',
  extension_mismatch: 'Conteúdo não corresponde à extensão',
  duplicate: 'Conteúdo repetido neste lote',
  interrupted: 'Envio interrompido',
  storage_unavailable: 'Armazenamento indisponível',
};

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
        : `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/** Nomes do plano de hierarquia: Líder = Supervisor; Operador = Usuário. */
export const roleLabel: Record<TeamRole, string> = { leader: 'Supervisor', operator: 'Usuário' };
export const statusLabel: Record<UserStatus, string> = {
  pending: 'Pendente',
  active: 'Ativo',
  suspended: 'Suspenso',
  rejected: 'Rejeitado',
};

// ---------- Traduções juramentadas (ADR-007) ----------

export type Language = 'pt' | 'en' | 'fr' | 'it' | 'es';
export type TranslationStatus = 'queued' | 'processing' | 'in_review' | 'awaiting_approval' | 'approved' | 'failed' | 'cancelled';
export type Align = 'left' | 'center' | 'right' | 'justify';
/** `claude` só aparece em rascunhos antigos (ADR-010). */
export type BlockOrigin = 'rules' | 'claude' | 'human' | 'machine' | 'memory';

export interface TableCellData {
  text: string;
  colSpan: number;
  rowSpan: number;
  bold: boolean;
  align: Align;
  /** Texto do original, quando conhecido. */
  sourceText?: string | null;
}

export interface TableRowData {
  style: 'normal' | 'header' | 'summary';
  cells: TableCellData[];
}

interface BlockBase {
  sourceText: string | null;
  origin: BlockOrigin;
}

export type DraftBlock =
  | (BlockBase & { kind: 'heading'; text: string; align: Align; level: 'title' | 'normal' })
  | (BlockBase & { kind: 'paragraph'; text: string; align: Align; bold: boolean; size: 'normal' | 'small' | 'tiny' })
  | (BlockBase & { kind: 'section'; text: string })
  | (BlockBase & { kind: 'translator_note'; text: string })
  | (BlockBase & { kind: 'signature'; illegible: boolean; name: string; role: string })
  | (BlockBase & { kind: 'table'; columns: number[]; rows: TableRowData[] });

export interface DraftContent {
  sourceLanguage: Language;
  targetLanguage: Language;
  documentType: string;
  sourceTitle: string;
  blocks: DraftBlock[];
}

export interface DraftIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  token?: string;
}

export interface TranslationSummary {
  id: string;
  translationMode: TranslationMode;
  modeLabel: string;
  stages: Stage[];
  /** Juramentada na máscara do tradutor (com número); `false` nas demais e na juramentada sem máscara (ADR-017). */
  useMask: boolean;
  preferredTranslator: { id: string; name: string } | null;
  pageCount: number | null;
  document: { id: string; name: string; tags: string[] };
  batch: {
    id: string;
    name: string | null;
    protocol: string | null;
    inspectionMode: 'all' | 'sample';
    inspectionSampleSize: number | null;
  };
  team: { id: string; name: string } | null;
  sourceLanguage: Language;
  targetLanguage: Language;
  status: TranslationStatus;
  requestedBy: string;
  uploadedBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Responsável: só ele e o Supervisor da equipe editam. */
  assignee: { id: string; name: string } | null;
  /** Tradutor juramentado escolhido na conclusão e edição da máscara usada. */
  translator: { id: string; name: string; maskEdition: number | null } | null;
  redoCount: number;
  reviewLifecycle: {
    consecutiveRejections: number;
    blocked: boolean;
    formatGeneration: number;
    inspectionRequired: boolean;
    lastInspectionRevision: number | null;
    failedStages: Stage[];
    isSampleDocument: boolean;
    sampleCovered: boolean;
  };
  timing: {
    estimatedSeconds: number;
    estimateBasis: string;
    estimateSamples: number;
    processedAt: string | null;
    completedAt: string | null;
    firstDownloadedAt: string | null;
    lastDownloadedAt: string | null;
    completionSeconds: number | null;
    waitingDownloadSeconds: number | null;
    idleSeconds: number;
    lastActivityAt: string;
  };
  annulled: { at: string; reason: string | null } | null;
  pendingNumberingRequest: string | null;
  documentType: string | null;
  sourceTitle: string | null;
  /** `false`: tipo de documento ainda não aprendido; `null`: ainda não processado. */
  patternKnown: boolean | null;
  createdAt: string;
  updatedAt: string;
  failureCode: string | null;
  currentRevision: number | null;
  errorCount: number;
  issueCount: number;
  number: string | null;
  permissions: {
    edit: boolean;
    submit: boolean;
    approve: boolean;
    returnForChanges: boolean;
    cancel: boolean;
    reprocess: boolean;
    download: boolean;
    claim: boolean;
    reassign: boolean;
    requestNumbering: boolean;
    /** Aprovar o Word: leva à próxima fase (ADR-017). */
    accept: boolean;
    registerNewFormat: boolean;
  };
}

/** Textos fixos da tradução juramentada, os mesmos do DOCX, para a prévia na tela. */
/** Textos da prévia que dependem só do idioma; timbre, abertura e encerramento vêm da máscara do tradutor (ADR-012). */
export interface PreviewFrame {
  draftMark: string | null;
  documentTypeLabel: string;
  translatorNote: { prefix: string; suffix: string };
  signatureMark: { illegible: string; legible: string };
}

export interface TranslationDetail {
  inspections: InspectionEvent[];
  rules: TranslationRules;
  checklist: ChecklistItem[];
  translation: TranslationSummary & {
    extractedText: string | null;
    notice: string | null;
    reviewComment: string | null;
    approvalOverrideReason: string | null;
  };
  frame: PreviewFrame;
  draft: {
    revision: number;
    content: DraftContent;
    issues: DraftIssue[];
    /** Correções feitas pela revisão automática nesta revisão (ADR-016). */
    corrections: Correction[];
    origin: string;
    createdAt: string;
    author: string | null;
  } | null;
}

export interface InspectionEvent {
  id: string;
  revision: number;
  formatGeneration: number;
  decision: 'approved' | 'rejected';
  scope: 'all' | 'sample';
  failedStages: Stage[];
  comment: string | null;
  inspectedAt: string;
  inspectedBy: string;
}

export interface Correction {
  code: string;
  block: number;
  before: string;
  after: string;
  message: string;
}

export interface AutoReviewResult {
  revision: number | null;
  corrections: Correction[];
  unresolved: string[];
  issues: DraftIssue[];
}

export interface TranslationFacets {
  statusCounts: Partial<Record<TranslationStatus, number>>;
  documentTypes: string[];
  tags: string[];
  approvers: Array<{ id: string; name: string }>;
}

export interface Capabilities {
  workerOnline: boolean;
  lastSeenAt: string | null;
  machineProviders: string[];
  machineProvider: 'libretranslate' | 'deepl' | 'none';
  machineAvailable: boolean;
  /** Há tradutor juramentado ativo com máscara: dá para concluir traduções. */
  translatorsReady: boolean;
}

// ---------- Tradutores juramentados (ADR-012) ----------

export interface SwornTranslator {
  id: string;
  name: string;
  registration: string | null;
  languages: string | null;
  notes: string | null;
  active: boolean;
  /** Edição da máscara em uso nas próximas conclusões. */
  mask: MaskEdition | null;
  /** Todas as edições guardadas, da mais recente para a mais antiga. */
  masks: MaskEdition[];
  referencePdf: { name: string | null; size: number } | null;
  ready: boolean;
  translations: number;
  updatedBy: string;
  updatedAt: string;
  permissions: { edit: boolean; download: boolean };
}

export interface MaskEdition {
  id: string;
  edition: number;
  name: string;
  size: number;
  markers: string[];
  /** Pronta para gerar traduções ({{texto}} no lugar certo); sem isso, aguarda configuração. */
  configured: boolean;
  /** O que falta para ficar pronta. */
  issues: string[];
  notes: string | null;
  /** Edição gerada de um modelo de moldura do sistema (ADR-019). */
  frame: {
    model: 'classico' | 'quadro' | 'bilingue' | 'compacto';
    label: string;
    city: string;
    state: string;
    contact: string | null;
    title: string | null;
  } | null;
  uploadedBy: string;
  uploadedAt: string;
  translations: number;
  current: boolean;
}

export interface MaskInspection {
  isWord: boolean;
  ok: boolean;
  markers: Array<{ name: string; part: string }>;
  errors: string[];
  warnings: string[];
}

/** Marcadores aceitos na máscara em Word (o mesmo texto do servidor). */
export const MASK_MARKERS: Array<[string, string]> = [
  ['texto', 'O documento traduzido (tabelas, parágrafos e notas). Obrigatório, sozinho num parágrafo do corpo.'],
  ['numero', 'Número da tradução, como digitado na conclusão.'],
  ['livro', 'Livro, como digitado na conclusão.'],
  ['folha', 'Folha, como digitada na conclusão.'],
  ['data', 'Data da conclusão por extenso, no idioma da tradução.'],
  ['data_curta', 'Data da conclusão em números.'],
  ['ano', 'Ano da conclusão.'],
  ['tipo', 'Tipo do documento (ex.: SCHOOL TRANSCRIPT).'],
  ['titulo_original', 'Título do documento original (ex.: HISTÓRICO ESCOLAR).'],
  ['idioma_origem', 'Idioma do original, escrito no idioma da tradução.'],
  ['idioma_destino', 'Idioma da tradução.'],
  ['tradutor', 'Nome do tradutor, como cadastrado.'],
];

export const providerLabel: Record<string, string> = {
  libretranslate: 'LibreTranslate (local, gratuito)',
  deepl: 'DeepL Free (externo)',
  none: 'Desligada',
};

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  team: { id: string; name: string } | null;
  batchId: string | null;
  documentId: string | null;
  translationId: string | null;
  createdAt: string;
  readAt: string | null;
}

export const notificationKindLabel: Record<string, string> = {
  translation_ready: 'Pronto para revisar',
  pattern_unknown: 'Tipo de documento novo',
  translation_submitted: 'Aguardando conclusão',
  translation_returned: 'Refazer',
  translation_approved: 'Concluído',
  translation_failed: 'Falha no processamento',
  batch_assigned: 'Lote direcionado',
  translation_assigned: 'Atribuída a você',
  quota_warning: 'Cota em 80%',
  quota_exhausted: 'Cota esgotada',
  quota_changed: 'Cota alterada',
  numbering_request: 'Pedido de numeração',
  numbering_decided: 'Decisão de numeração',
};

// ---------- Numeração e painéis (plano de hierarquia) ----------

export interface QuotaUsage {
  quota: number | null;
  used: number;
}

export interface NumberingOverview {
  year: number;
  mine: QuotaUsage;
  organization: QuotaUsage | null;
  teams: Array<QuotaUsage & { id: string; name: string; canEdit: boolean }>;
  users: Array<
    QuotaUsage & { id: string; name: string; email: string; teams: Array<{ id: string; name: string; role: TeamRole }>; canEdit: boolean }
  >;
}

export interface NumberingRequest {
  id: string;
  translationId: string;
  document: { id: string; name: string };
  team: { id: string; name: string } | null;
  kind: 'change' | 'annul';
  reason: string;
  translator: { id: string; name: string } | null;
  current: { number: string; book: string | null; sheet: string | null };
  requested: { number: string | null; book: string | null; sheet: string | null };
  previous: { number: string | null; book: string | null; sheet: string | null } | null;
  status: 'pending' | 'approved' | 'rejected' | 'reverted';
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  permissions: { decide: boolean; revert: boolean };
}

export const requestStatusLabel: Record<NumberingRequest['status'], string> = {
  pending: 'Aguardando decisão',
  approved: 'Autorizado',
  rejected: 'Recusado',
  reverted: 'Revertido pelo Diretor',
};

export interface OrganizationDashboard {
  period: { from: string; to: string };
  totals: {
    received: number;
    approved: number;
    inProgress: number;
    failed: number;
    firstTime: number;
    redone: number;
    overridden: number;
    avgMinutesToConclude: number | null;
  };
  byPair: Array<{ source: Language; target: Language; count: number }>;
  byType: Array<{ type: string; total: number; firstTime: number; redone: number; overridden: number }>;
  byTeam: Array<{ team: { id: string; name: string } | null; received: number; approved: number; inProgress: number }>;
  byWeek: Array<{ week: string; approved: number }>;
  numbering: { year: number; organization: QuotaUsage; teams: Array<QuotaUsage & { team: { id: string; name: string } }> };
}

export interface TeamDashboard {
  period: { from: string; to: string };
  team: { id: string; name: string };
  totals: { delivered: number; inProgress: number; firstTime: number; avgMinutesToConclude: number | null };
  users: Array<
    QuotaUsage & {
      id: string;
      name: string;
      role: TeamRole | null;
      inProgress: number;
      delivered: number;
      redone: number;
      avgReviewMinutes: number | null;
      avgTotalMinutes: number | null;
    }
  >;
  documents: Array<{
    id: string;
    name: string;
    assignee: string | null;
    status: TranslationStatus;
    documentType: string | null;
    createdAt: string;
    approvedAt: string | null;
    processingMinutes: number | null;
    reviewMinutes: number | null;
    conclusionMinutes: number | null;
    totalMinutes: number | null;
    protocol: string | null;
    firstDownloadedAt: string | null;
    lastActivityAt: string;
    minutesUntilFirstDownload: number | null;
    idleMinutes: number;
    readyWithoutDownloadMinutes: number | null;
    redoCount: number;
    number: string | null;
  }>;
}

/** Monta a query string ignorando filtros vazios. */
export function queryString(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface GlossaryEntry {
  id: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  sourceTerm: string;
  targetTerm: string;
  note: string | null;
  /** De onde veio o termo (ex.: "Skill traducao-eng"). */
  origin?: string | null;
  team: { id: string; name: string } | null;
  createdBy: string;
  canEdit: boolean;
}

export const languageLabel: Record<Language, string> = { pt: 'Português', en: 'Inglês', fr: 'Francês', it: 'Italiano', es: 'Espanhol' };
export const LANGUAGES: Language[] = ['pt', 'en', 'fr', 'it', 'es'];

/** Todas as vinte direções entre os cinco idiomas. */
export const LANGUAGE_PAIRS: Array<{ value: string; source: Language; target: Language; label: string }> = LANGUAGES.flatMap((source) =>
  LANGUAGES.filter((target) => target !== source).map((target) => ({
    value: `${source}-${target}`,
    source,
    target,
    label: `${languageLabel[source]} → ${languageLabel[target]}`,
  })),
);
export const splitPair = (value: string) => value.split('-') as [Language, Language];

// ---------- Modalidades de tradução (ADR-015) ----------

export type TranslationMode = 'sworn' | 'certified' | 'technical' | 'simple';
export type Stage = 'correction' | 'translation' | 'layout' | 'review';
export const MODES: TranslationMode[] = ['sworn', 'certified', 'technical', 'simple'];
export const modeLabel: Record<TranslationMode, string> = {
  sworn: 'Juramentada',
  certified: 'Certificada',
  technical: 'Técnica',
  simple: 'Simples',
};
export const modeHint: Record<TranslationMode, string> = {
  sworn: 'Correção + tradução + revisão; número e máscara do tradutor juramentado',
  certified: 'Tradução + diagramação + revisão; declaração do tradutor, sem número',
  technical: 'Tradução + diagramação + revisão; layout fiel ao original',
  simple: 'Tradução + revisão',
};
export const stageLabel: Record<Stage, string> = {
  correction: 'Correção',
  translation: 'Tradução',
  layout: 'Diagramação',
  review: 'Revisão',
};

export interface TranslationRules {
  font: string;
  fontSize: number;
  fileSuffix: string;
  dates: 'long' | 'as_original';
  numbers: 'keep' | 'convert';
  visualElements: 'markers' | 'translator_notes';
  institutions: 'translate' | 'keep';
  otherLanguages: 'transcribe' | 'translate';
  bordersOnlyInTables: boolean;
  swornFrame: boolean;
  statement: string | null;
  checklist: { correction: string[]; layout: string[]; review: string[] };
}

export interface ChecklistItem {
  key: string;
  stage: Stage;
  label: string;
  checked: { by: string; name: string; at: string } | null;
}

export interface ProfilesOverview {
  canEdit: boolean;
  modes: Array<{
    mode: TranslationMode;
    label: string;
    stages: Array<{ stage: Stage; label: string }>;
    languages: Array<{
      target: Language;
      rules: TranslationRules;
      customized: boolean;
      updatedBy: string | null;
      updatedAt: string | null;
    }>;
  }>;
}
export const pairLabel = (source: Language, target: Language) => `${source.toUpperCase()} → ${target.toUpperCase()}`;

export const translationStatusLabel: Record<TranslationStatus, string> = {
  queued: 'Processando',
  processing: 'Processando',
  in_review: 'Para revisar',
  awaiting_approval: 'Aguardando conclusão',
  approved: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

/** Rótulos legíveis das ações da auditoria; ações sem rótulo aparecem pelo código. */
export const auditActionLabel: Record<string, string> = {
  'translation.inspected': 'Conferência comparativa registrada',
  'translation.inspection_approved': 'Comparação do original e Word aprovada',
  'translation.inspection_rejected': 'Documento reprovado na comparação',
  'translation.review_blocked': 'Três reprovações consecutivas: novo formato obrigatório',
  'translation.format_registered': 'Nova forma de formatação registrada',
  'translation.languages_changed': 'Idiomas corrigidos e documento reenfileirado',
  'translation.completed_invalidated': 'Versão concluída invalidada após confirmação',
  'translation.archive_downloaded': 'Pacote de traduções baixado',
  'batch.protocol_omitted': 'Remessa sem protocolo, com justificativa',
  'batch.inspection_selected': 'Inspeção completa ou por amostra escolhida',
  'document.previewed': 'Original visualizado para comparação',
  'auth.login': 'Entrou no sistema',
  'auth.login_failed': 'Tentativa de login recusada',
  'auth.logout': 'Saiu do sistema',
  'auth.signup': 'Pediu cadastro',
  'auth.signup_duplicate': 'Cadastro repetido',
  'auth.login_denied': 'Login negado (conta inativa)',
  'session.revoked': 'Sessão encerrada',
  'user.director_granted': 'Tornou-se Diretor',
  'user.director_revoked': 'Deixou de ser Diretor',
  'team.created': 'Equipe criada',
  'team.renamed': 'Equipe renomeada',
  'team.member_added': 'Membro adicionado',
  'team.member_removed': 'Membro removido',
  'team.member_role_changed': 'Função alterada',
  'batch.cancelled': 'Pendentes do lote cancelados',
  'document.upload_failed': 'Envio falhou',
  'director.bootstrapped': 'Primeiro Diretor criado',
  'user.approved': 'Cadastro aprovado',
  'user.rejected': 'Cadastro rejeitado',
  'user.suspended': 'Usuário suspenso',
  'user.reactivated': 'Usuário reativado',
  'batch.created': 'Lote criado',
  'batch.assigned': 'Lote direcionado',
  'document.stored': 'Documento armazenado',
  'document.rejected': 'Documento recusado',
  'document.downloaded': 'Original baixado',
  'document.tagged': 'Etiquetas alteradas',
  'document.cancelled': 'Documento cancelado',
  'translation.requested': 'Tradução solicitada',
  'translation.drafted': 'Rascunho gerado',
  'translation.machine_translated': 'Tradução automática',
  'translation.edited': 'Rascunho editado',
  'translation.submitted': 'Marcada como pronta',
  'translation.returned': 'Pedido para refazer',
  'translation.reprocess_requested': 'Reprocessamento pedido',
  'translation.approved': 'Tradução concluída',
  'translation.claimed': 'Tradução assumida',
  'translation.reassigned': 'Tradução reatribuída',
  'numbering.quota_set': 'Cota de numeração alterada',
  'numbering.requested': 'Pedido de alteração de número',
  'numbering.approved': 'Pedido de número autorizado',
  'numbering.rejected': 'Pedido de número recusado',
  'numbering.reverted': 'Pedido de número revertido',
  'translation.downloaded': 'Tradução baixada',
  'translation.cancelled': 'Tradução cancelada',
  'translation.failed': 'Falha no processamento',
  'translation.settings_updated': 'Tradutor público configurado (antigo)',
  'translator.created': 'Tradutor juramentado cadastrado',
  'translator.updated': 'Tradutor juramentado alterado',
  'translator.mask_uploaded': 'Máscara do tradutor enviada',
  'translator.pdf_uploaded': 'PDF do tradutor enviado',
  'translator.mask_selected': 'Edição da máscara escolhida',
  'translation.machine_provider_set': 'Provedor de tradução alterado',
  'glossary.added': 'Termo adicionado ao glossário',
  'glossary.removed': 'Termo removido do glossário',
  'ai.choice_set': 'Escolha com IA / sem IA alterada',
  'ai.settings_updated': 'Configuração da IA alterada',
  'ai.skill_saved': 'Habilidade da IA salva',
  'ai.skill_removed': 'Habilidade da IA removida',
  'ai.access_set': 'Acesso à IA alterado',
  'ai.layout_approved': 'Diagramação da IA aprovada',
  'ai.layout_rejected': 'Diagramação da IA descartada',
};

export const auditCategoryLabel: Record<string, string> = {
  auth: 'Acesso',
  user: 'Usuários',
  team: 'Equipes',
  batch: 'Lotes',
  document: 'Documentos',
  translation: 'Traduções',
  glossary: 'Glossário',
  numbering: 'Numeração',
  translator: 'Tradutores',
  session: 'Sessões',
  director: 'Diretoria',
  ai: 'Inteligência artificial',
};

export const failureLabel: Record<string, string> = {
  consecutive_review_errors: 'Três reprovações consecutivas',
  unsupported_format: 'Formato sem suporte nesta fase',
  document_unavailable: 'Documento indisponível',
  attempts_exhausted: 'Tentativas esgotadas',
  processing_error: 'Erro no processamento',
};

// ---------- Padrões de documento (ADR-017) ----------

export type PatternVerdict = 'can' | 'review' | 'cannot';

export interface DocumentPattern {
  title: string;
  documentType: string | null;
  verdict: PatternVerdict;
  verdictLabel: string;
  reasons: string[];
  total: number;
  approved: number;
  failed: number;
  active: number;
  averageErrors: number;
  averageCorrections: number;
  lastAt: string;
  formats: string[];
  pairs: string[];
  modes: TranslationMode[];
}

export interface PatternTest {
  verdict: PatternVerdict;
  verdictLabel: string;
  reasons: string[];
  format: string | null;
  pages: number | null;
  words: number;
  structure: { tables: number; headings: number; paragraphs: number; signatures: number; markers: number } | null;
  known: { title: string; approved: number } | null;
  /** Documentos conhecidos combinados na diagramação de um tipo novo (ADR-020). */
  composedFrom: Array<{ title: string; similarity: number }>;
  bodyModel: string;
  documentType: string;
  sourceTitle: string;
  notice: string | null;
  corrections: Correction[];
  unresolved: string[];
  issues: DraftIssue[];
  draft: DraftContent | null;
  durationMs: number;
  previewDocx: string | null;
  previewPdf?: string | null;
  originalPreviewPdf?: string | null;
  previewError?: string | null;
}

// ---------- Gerenciamento AI (ADR-021) ----------
export type AiTask = 'glossary_check' | 'layout_combination' | 'process_help';
export type AiOutcomeStatus = 'ok' | 'blocked' | 'failed' | 'unavailable' | 'denied';

export interface AiStatus {
  configured: boolean;
  enabled: boolean;
  model: string;
  allowed: boolean;
  /** Escolha da pessoa: trabalhar com IA ou sem IA (ADR-022). */
  useAi: boolean;
  available: boolean;
  canManage: boolean;
  canToggle: boolean;
}

export interface AiSkillItem {
  id: string;
  name: string;
  content: string;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface AiSettings extends AiStatus {
  governancePrompt: string;
  defaultGovernancePrompt: string;
  skills: AiSkillItem[];
}

export interface AiAccessItem {
  userId: string;
  name: string;
  email: string;
  teams: string[];
  allowed: boolean;
  setBy: string | null;
}

export interface AiRequestItem {
  id: string;
  task: AiTask;
  taskLabel: string;
  status: AiOutcomeStatus;
  reason: string | null;
  durationMs: number | null;
  at: string;
  user: string | null;
  document: string | null;
  translationId: string | null;
}

export interface AiCombination {
  id: string;
  translationId: string;
  status: 'proposed' | 'approved' | 'rejected';
  rationale: string | null;
  createdAt: string;
  styles: Array<{ role: string; label: string; align: Align; bold: boolean; size: 'normal' | 'small' | 'tiny'; heading: boolean }>;
  fieldsAsTable: boolean;
  labelWidth: number | null;
}

export const aiStatusLabel: Record<AiOutcomeStatus, string> = {
  ok: 'Respondeu',
  blocked: 'Barrada',
  failed: 'Falhou',
  unavailable: 'Indisponível',
  denied: 'Acesso negado',
};

export interface AiComparisonPoint {
  received: number;
  approved: number;
  firstTime: number;
  avgMinutes: number | null;
}

export interface AiComparisonSummary extends AiComparisonPoint {
  inProgress: number;
  redone: number;
}

export interface AiComparison {
  period: { from: string; to: string };
  scope: 'organization' | 'team' | 'led_teams';
  withAi: AiComparisonSummary;
  withoutAi: AiComparisonSummary;
  weeks: Array<{ week: string; withAi: AiComparisonPoint; withoutAi: AiComparisonPoint }>;
  aiCalls: Partial<Record<AiOutcomeStatus, number>>;
}

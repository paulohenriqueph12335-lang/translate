import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  languageLabel,
  MODES,
  modeLabel,
  splitPair,
  stageLabel,
  type Stage,
  type DocumentPattern,
  type PatternTest,
  type PatternVerdict,
  type TranslationMode,
  type DocumentCategory,
} from './api';
import { PairSelect } from './Modes';
import { PdfPreview } from './PdfPreview';
import { dateTime, Feedback, message, Section, useLoad } from './ui';
import { DocumentCategorySelect, useDocumentCategories } from './DocumentClassification';

const TONE: Record<PatternVerdict, string> = { can: '', review: 'warn', cannot: 'danger' };
type LayoutPreset = 'source' | 'left' | 'justify' | 'center';
interface PatternTrial {
  id: string;
  revision: number;
  consecutiveRejections: number;
  blocked: boolean;
  formatGeneration: number;
  layoutPreset: LayoutPreset;
  requiresRegeneration: boolean;
  decision: 'approved' | 'rejected' | null;
  failedStages: Stage[];
  comment: string | null;
}
type ReviewedPatternTest = PatternTest & { trial?: PatternTrial };
const layoutOptions: Array<[LayoutPreset, string]> = [
  ['source', 'Estrutura do original'],
  ['left', 'Alinhar à esquerda'],
  ['justify', 'Justificar parágrafos e células'],
  ['center', 'Centralizar parágrafos e células'],
];

function VerdictBadge({ verdict, label }: { verdict: PatternVerdict; label: string }) {
  return <span className={`badge verdict ${TONE[verdict]}`}>{label}</span>;
}

const pairText = (pair: string) => {
  const [from, to] = pair.split('-') as [keyof typeof languageLabel, keyof typeof languageLabel];
  return `${from.toUpperCase()} → ${to.toUpperCase()}`;
};

/**
 * Padrões de documento (ADR-017): para saber se o sistema consegue fazer um tipo de documento. O teste roda o mesmo
 * caminho da tradução (leitura, layout, tradução, revisão automática) sem criar tradução nem guardar o arquivo; o
 * histórico mostra o resultado real de cada tipo que já passou pelo sistema.
 */
export function Patterns() {
  const history = useLoad(() => api<{ items: DocumentPattern[] }>('GET', '/document-patterns'), []);
  return (
    <Section title="Padrões de documento" subtitle="Teste um documento novo e veja o que o sistema já sabe fazer.">
      <PatternTester />
      <h3 className="top-gap">Tipos que já passaram pelo sistema</h3>
      <Feedback error={history.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo de documento</th>
              <th>Resultado</th>
              <th>Traduções</th>
              <th>Idiomas</th>
              <th>Último</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.items.map((item) => (
              <tr key={item.title}>
                <td className="name-cell">
                  <strong>{item.title}</strong>
                  {item.documentType && item.documentType !== item.title && (
                    <span className="muted small-text block-line">{item.documentType}</span>
                  )}
                  <span className="muted small-text block-line">
                    {item.formats.map((format) => format.toUpperCase()).join(', ')} · {item.modes.map((mode) => modeLabel[mode]).join(', ')}
                  </span>
                </td>
                <td>
                  <VerdictBadge verdict={item.verdict} label={item.verdictLabel} />
                  <ul className="reasons">
                    {item.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </td>
                <td className="nowrap">
                  {item.approved} concluída(s) de {item.total}
                  {item.failed > 0 && <span className="muted small-text block-line">{item.failed} falha(s)</span>}
                  {item.active > 0 && <span className="muted small-text block-line">{item.active} em andamento</span>}
                  <span className="muted small-text block-line">
                    {item.averageCorrections} correção(ões) automáticas em média · {item.averageErrors} problema(s) restante(s)
                  </span>
                </td>
                <td>{item.pairs.map(pairText).join(', ')}</td>
                <td className="nowrap">{dateTime(item.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.data && history.data.items.length === 0 && <p className="empty">Nenhum documento processado ainda.</p>}
    </Section>
  );
}

function PatternTester() {
  const [file, setFile] = useState<File | null>(null);
  const [pair, setPair] = useState('pt-en');
  const [mode, setMode] = useState<TranslationMode>('sworn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewedPatternTest | null>(null);
  const [trial, setTrial] = useState<PatternTrial | null>(null);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('source');
  const [generatedPreset, setGeneratedPreset] = useState<LayoutPreset | null>(null);
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory | ''>('');
  const [generatedCategory, setGeneratedCategory] = useState<DocumentCategory | '' | null>(null);
  const categories = useDocumentCategories();
  const [reviewBusy, setReviewBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operating = useRef(false);
  const request = useRef<AbortController | null>(null);
  const locked = busy || reviewBusy;
  const previewCurrent = !result || (generatedPreset === layoutPreset && generatedCategory === documentCategory);

  useEffect(() => () => request.current?.abort(), []);

  async function test() {
    if (!file || operating.current) return;
    operating.current = true;
    const controller = new AbortController();
    request.current = controller;
    const requestedPreset = layoutPreset;
    const requestedCategory = documentCategory;
    setBusy(true);
    setError(null);
    try {
      const [sourceLanguage, targetLanguage] = splitPair(pair);
      const response = await fetch(
        `/api/v1/document-patterns/test?sourceLanguage=${sourceLanguage}&targetLanguage=${targetLanguage}&mode=${mode}&includePreview=true&layoutPreset=${layoutPreset}${documentCategory ? `&documentCategory=${documentCategory}` : ''}`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Protection': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
          body: file,
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (controller.signal.aborted || request.current !== controller) return;
      if (!response.ok) {
        if (data?.error?.details?.trial) setTrial(data.error.details.trial as PatternTrial);
        throw new ApiError(response.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Falha no teste');
      }
      setResult(data as ReviewedPatternTest);
      setGeneratedPreset((data.trial?.layoutPreset as LayoutPreset | undefined) ?? requestedPreset);
      setGeneratedCategory(requestedCategory);
      if (data.trial) {
        setTrial(data.trial as PatternTrial);
        setLayoutPreset(data.trial.layoutPreset as LayoutPreset);
      }
    } catch (caught) {
      if (!controller.signal.aborted && request.current === controller) setError(message(caught));
    } finally {
      if (request.current === controller) {
        request.current = null;
        operating.current = false;
        setBusy(false);
      }
    }
  }

  function downloadPreview() {
    if (!result?.previewDocx || !file) return;
    const bytes = Uint8Array.from(atob(result.previewDocx), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `TESTE - ${file.name.replace(/\.[^.]+$/, '')}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const errors = result?.issues.filter((issue) => issue.severity === 'error') ?? [];
  return (
    <div className="card pattern-test">
      <h3>Testar um documento novo</h3>
      <p className="muted small-text">
        O arquivo e seu texto não são guardados. O sistema registra a identificação por digest, a diagramação sem conteúdo e as decisões de
        revisão do ensaio; nenhuma tradução de produção é criada.
      </p>
      <fieldset
        className="filters"
        aria-label="Parâmetros do ensaio"
        disabled={locked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <button type="button" onClick={() => input.current?.click()}>
          {file ? file.name : 'Escolher arquivo'}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
          onChange={(event) => {
            if (operating.current) return;
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setTrial(null);
            setGeneratedPreset(null);
            setGeneratedCategory(null);
            setDocumentCategory('');
            setLayoutPreset('source');
            event.target.value = '';
          }}
        />
        <PairSelect
          value={pair}
          onChange={(value) => {
            if (operating.current) return;
            setPair(value);
            setResult(null);
            setTrial(null);
            setGeneratedPreset(null);
            setGeneratedCategory(null);
            setLayoutPreset('source');
          }}
        />
        <select
          aria-label="Modalidade"
          value={mode}
          onChange={(e) => {
            if (operating.current) return;
            setMode(e.target.value as TranslationMode);
            setResult(null);
            setTrial(null);
            setGeneratedPreset(null);
            setGeneratedCategory(null);
            setLayoutPreset('source');
          }}
        >
          {MODES.map((value) => (
            <option key={value} value={value}>
              {modeLabel[value]}
            </option>
          ))}
        </select>
        <DocumentCategorySelect
          value={documentCategory}
          categories={categories.data?.categories ?? []}
          onChange={(value) => {
            if (!operating.current) setDocumentCategory(value);
          }}
        />
        <select
          aria-label="Diagramação do ensaio"
          value={layoutPreset}
          disabled={busy || trial?.blocked || trial?.requiresRegeneration}
          onChange={(e) => {
            if (!operating.current) setLayoutPreset(e.target.value as LayoutPreset);
          }}
        >
          {layoutOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!file || busy || trial?.blocked} onClick={() => void test()}>
          {busy ? 'Testando…' : trial ? 'Gerar Word e comparar novamente' : 'Testar'}
        </button>
      </fieldset>
      <Feedback error={error ?? categories.error} />
      {!previewCurrent && (
        <p className="alert info" role="status">
          As opções de modelo ou diagramação mudaram. O Word abaixo ainda usa «
          {categories.data?.categories.find((item) => item.value === generatedCategory)?.label ?? 'Identificação automática'} ·{' '}
          {layoutOptions.find(([value]) => value === generatedPreset)?.[1]}». Gere o Word novamente para aplicar a seleção e liberar a
          revisão.
        </p>
      )}
      {result && (
        <div className={`pattern-result ${result.verdict}`}>
          <div className="word-head">
            <div>
              <VerdictBadge verdict={result.verdict} label={result.verdictLabel} />{' '}
              <strong>{result.documentType || result.sourceTitle || file?.name}</strong>
              <span className="muted small-text block-line">
                {result.format?.toUpperCase() ?? 'formato desconhecido'}
                {result.pages ? ` · ${result.pages} página(s)` : ''}
                {result.words ? ` · ${result.words} palavras` : ''}
                {result.durationMs ? ` · analisado em ${(result.durationMs / 1000).toFixed(1)} s` : ''}
              </span>
            </div>
            {result.previewDocx && (
              <button onClick={downloadPreview} className="small">
                Baixar prévia do teste (Word)
              </button>
            )}
          </div>
          <ul className="reasons">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {result.structure && (
            <p className="small-text">
              Estrutura reconhecida: {result.structure.tables} tabela(s), {result.structure.headings} título(s),{' '}
              {result.structure.paragraphs} parágrafo(s), {result.structure.signatures} assinatura(s), {result.structure.markers}{' '}
              elemento(s) visual(is) · {result.corrections.length} correção(ões) automáticas
              {result.known ? ` · já há ${result.known.approved} tradução(ões) concluída(s) de "${result.known.title}"` : ''}
            </p>
          )}
          {result.composedFrom.length > 0 && (
            <p className="small-text">
              <strong>Diagramação construída</strong> combinando documentos conhecidos de estrutura parecida:{' '}
              {result.composedFrom
                .slice(0, 4)
                .map((item) => `${item.title} (${item.similarity}%)`)
                .join(', ')}
              .
            </p>
          )}
          {(errors.length > 0 || result.unresolved.length > 0) && (
            <details>
              <summary>O que precisa de conferência</summary>
              <ul>
                {errors.map((issue, index) => (
                  <li key={`e${index}`} className="error-text">
                    {issue.message}
                  </li>
                ))}
                {result.unresolved.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {file && (result || trial) && (
        <PatternComparison
          file={file}
          result={result}
          trial={trial}
          busy={busy}
          previewCurrent={previewCurrent}
          onBusy={(value) => {
            operating.current = value;
            setReviewBusy(value);
          }}
          onTrial={(value) => {
            setTrial(value);
            setLayoutPreset(value.layoutPreset);
          }}
          onGenerate={() => void test()}
        />
      )}
    </div>
  );
}

/** O teste de formato usa o mesmo Word do resultado e o arquivo original, sem guardar documentos do usuário. */
function PatternComparison({
  file,
  result,
  trial,
  busy,
  previewCurrent,
  onBusy,
  onTrial,
  onGenerate,
}: {
  file: File;
  result: PatternTest | null;
  trial: PatternTrial | null;
  busy: boolean;
  previewCurrent: boolean;
  onBusy: (busy: boolean) => void;
  onTrial: (trial: PatternTrial) => void;
  onGenerate: () => void;
}) {
  const [urls, setUrls] = useState<{ original: string | null; word: string | null; docx: string | null }>({
    original: null,
    word: null,
    docx: null,
  });
  const [reason, setReason] = useState('');
  const [failedStages, setFailedStages] = useState<Stage[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [formatName, setFormatName] = useState('');
  const [explanation, setExplanation] = useState('');
  const [newPreset, setNewPreset] = useState<LayoutPreset>('center');
  const history = useLoad(
    () =>
      trial
        ? api<{
            history: Array<{
              revision: number;
              formatGeneration: number;
              decision: string;
              failedStages: Stage[];
              comment: string | null;
              reviewedAt: string;
            }>;
          }>('GET', `/document-patterns/trials/${trial.id}`)
        : Promise.resolve({ history: [] }),
    [trial?.id, trial?.revision, trial?.decision, trial?.formatGeneration],
  );
  useEffect(() => {
    setReviewed(false);
    setReason('');
    setFailedStages([]);
    setError(null);
  }, [trial?.id, trial?.revision, trial?.formatGeneration, previewCurrent]);
  async function inspect(decision: 'approved' | 'rejected') {
    if (!trial || busy || submitting.current || !previewCurrent) return;
    submitting.current = true;
    onBusy(true);
    setSending(true);
    setError(null);
    try {
      const response = await api<{ trial: PatternTrial }>('POST', `/document-patterns/trials/${trial.id}/inspect`, {
        baseRevision: trial.revision,
        decision,
        failedStages: decision === 'rejected' ? failedStages : [],
        comment: reason.trim() || undefined,
      });
      onTrial(response.trial);
    } catch (caught) {
      setError(message(caught));
    } finally {
      submitting.current = false;
      setSending(false);
      onBusy(false);
    }
  }
  async function registerFormat() {
    if (!trial || busy || submitting.current) return;
    submitting.current = true;
    onBusy(true);
    setSending(true);
    setError(null);
    try {
      const response = await api<{ trial: PatternTrial }>('POST', `/document-patterns/trials/${trial.id}/formats`, {
        baseRevision: trial.revision,
        name: formatName.trim(),
        explanation: explanation.trim(),
        layoutPreset: newPreset,
      });
      onTrial(response.trial);
      setFormatName('');
      setExplanation('');
      setReviewed(false);
    } catch (caught) {
      setError(message(caught));
    } finally {
      submitting.current = false;
      setSending(false);
      onBusy(false);
    }
  }
  const decode = (value: string, type: string) =>
    new Blob([Uint8Array.from(atob(value), (character) => character.charCodeAt(0))], { type });
  useEffect(() => {
    if (!result) {
      setUrls({ original: null, word: null, docx: null });
      return;
    }
    const created: string[] = [];
    const url = (blob: Blob) => {
      const value = URL.createObjectURL(blob);
      created.push(value);
      return value;
    };
    const image = result.format === 'png' || result.format === 'jpeg';
    setUrls({
      original: result.originalPreviewPdf
        ? url(decode(result.originalPreviewPdf, 'application/pdf'))
        : result.format === 'pdf'
          ? url(new Blob([file], { type: 'application/pdf' }))
          : image
            ? url(new Blob([file], { type: `image/${result.format}` }))
            : null,
      word: result.previewPdf ? url(decode(result.previewPdf, 'application/pdf')) : null,
      docx: result.previewDocx
        ? url(decode(result.previewDocx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        : null,
    });
    return () => created.forEach((value) => URL.revokeObjectURL(value));
  }, [file, result]);
  return (
    <section className="pattern-comparison">
      <h4>Compare antes de aceitar a formatação</h4>
      <div className="document-comparison">
        <section className="comparison-pane">
          <div className="word-head">
            <h4>Original: {file.name}</h4>
          </div>
          {urls.original ? (
            result?.format === 'png' || result?.format === 'jpeg' ? (
              <img className="comparison-image" alt={`Original ${file.name}`} src={urls.original} />
            ) : (
              <PdfPreview title="Original do teste de formatação" url={urls.original} />
            )
          ) : (
            <p className="comparison-fallback">
              A prévia do original não está disponível neste formato. Confira o arquivo local antes de decidir.
            </p>
          )}
        </section>
        <section className="comparison-pane">
          <div className="word-head">
            <h4>Word da formatação proposta</h4>
            {urls.docx && (
              <a className="button small" href={urls.docx} download={`TESTE - ${file.name.replace(/\.[^.]+$/, '')}.docx`}>
                Baixar Word
              </a>
            )}
          </div>
          {urls.word ? (
            <PdfPreview title="Word proposto no teste de formatação" url={urls.word} />
          ) : (
            <div className="comparison-fallback">
              <p>{result?.previewError ?? 'Converta ou baixe o Word para conferir a formatação.'}</p>
              <p className="muted small-text">O resultado técnico acima não equivale à aprovação humana.</p>
            </div>
          )}
        </section>
      </div>
      <p className="muted small-text">
        A revisão do ensaio fica registrada sem guardar o arquivo ou seu texto. A aprovação deste teste não conclui traduções de produção.
      </p>
      {trial && (
        <section className="inspection-gate">
          <h4>Revisão persistida do ensaio</h4>
          <p>
            Revisão {trial.revision} · formato {trial.formatGeneration} · {trial.consecutiveRejections} de 3 reprovações consecutivas
          </p>
          {trial.blocked && (
            <p className="alert error" role="alert">
              Erros consecutivos: três reprovações. Registre uma nova formatação com alteração real antes da quarta tentativa.
            </p>
          )}
          {trial.requiresRegeneration && (
            <p className="alert info">
              Novo formato registrado. Gere o Word novamente e compare a nova revisão antes de decidir. Se a diagramação não mudar, registre
              outra opção abaixo.
            </p>
          )}
          {trial.decision === 'approved' && (
            <p className="alert success" role="status">
              Esta revisão do ensaio foi aprovada e a decisão está na auditoria.
            </p>
          )}
          {trial.decision === 'rejected' && (
            <p className="alert error">
              Revisão reprovada: {trial.comment} · fases: {trial.failedStages.map((stage) => stageLabel[stage]).join(', ')}. Corrija a
              diagramação e gere um novo resultado; repetir o mesmo resultado mantém a mesma revisão.
            </p>
          )}
          {!trial.blocked && !trial.requiresRegeneration && !trial.decision && trial.revision > 0 && (
            <div className="form">
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || sending || !previewCurrent || !result?.previewDocx}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                Comparei o original e o Word desta revisão.
              </label>
              <fieldset disabled={busy || sending}>
                <legend>Fases com falha, se houver reprovação</legend>
                <div className="inspection-stages">
                  {(['correction', 'translation', 'layout', 'review'] as Stage[]).map((stage) => (
                    <label className="check" key={stage}>
                      <input
                        type="checkbox"
                        checked={failedStages.includes(stage)}
                        onChange={(e) =>
                          setFailedStages((current) =>
                            e.target.checked ? [...current, stage] : current.filter((value) => value !== stage),
                          )
                        }
                      />
                      {stageLabel[stage]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Comentário ou motivo da reprovação
                <textarea rows={3} maxLength={2000} value={reason} disabled={busy || sending} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || sending || !previewCurrent || !reviewed || failedStages.length > 0}
                  onClick={() => void inspect('approved')}
                >
                  Aprovar revisão do ensaio
                </button>
                <button
                  className="danger"
                  disabled={busy || sending || !previewCurrent || !reviewed || !failedStages.length || reason.trim().length < 3}
                  onClick={() => void inspect('rejected')}
                >
                  Reprovar e registrar as fases
                </button>
              </div>
            </div>
          )}
          {trial.requiresRegeneration && (
            <button className="primary" disabled={busy || sending} onClick={onGenerate}>
              {busy ? 'Gerando…' : 'Gerar Word com o novo formato'}
            </button>
          )}
          {trial.revision > 0 && (
            <details className="format-registration" open={trial.blocked || trial.requiresRegeneration}>
              <summary>Registrar nova forma de formatação</summary>
              <div className="form">
                <label>
                  Nome do formato
                  <input
                    value={formatName}
                    minLength={3}
                    maxLength={120}
                    disabled={busy || sending}
                    onChange={(e) => setFormatName(e.target.value)}
                  />
                </label>
                <label>
                  Motivo e alterações propostas
                  <textarea
                    rows={3}
                    value={explanation}
                    minLength={5}
                    maxLength={2000}
                    disabled={busy || sending}
                    onChange={(e) => setExplanation(e.target.value)}
                  />
                </label>
                <label>
                  Diagramação que será aplicada no Word
                  <select value={newPreset} disabled={busy || sending} onChange={(e) => setNewPreset(e.target.value as LayoutPreset)}>
                    {layoutOptions.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small-text">
                  O servidor compara as propriedades de layout. Apenas trocar o nome ou escolher uma opção que produza a mesma estrutura não
                  libera outra tentativa.
                </p>
                <button
                  disabled={busy || sending || formatName.trim().length < 3 || explanation.trim().length < 5}
                  onClick={() => void registerFormat()}
                >
                  {trial.requiresRegeneration ? 'Substituir formato pendente' : 'Registrar novo formato e liberar geração'}
                </button>
              </div>
            </details>
          )}
          <Feedback error={error ?? history.error} />
          {!!history.data?.history.length && (
            <details>
              <summary>Histórico de revisões do ensaio</summary>
              <ol className="inspection-history">
                {history.data.history.map((item) => (
                  <li key={`${item.revision}-${item.decision}`}>
                    <strong>
                      Revisão {item.revision} · formato {item.formatGeneration} · {item.decision === 'approved' ? 'Aprovada' : 'Reprovada'}
                    </strong>
                    <span>
                      {dateTime(item.reviewedAt)}
                      {item.failedStages.length ? ` · ${item.failedStages.map((stage) => stageLabel[stage]).join(', ')}` : ''}
                    </span>
                    {item.comment && <span>{item.comment}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}
    </section>
  );
}

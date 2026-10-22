import { useRef, useState } from 'react';
import {
  api,
  ApiError,
  languageLabel,
  MODES,
  modeLabel,
  splitPair,
  type DocumentPattern,
  type PatternTest,
  type PatternVerdict,
  type TranslationMode,
} from './api';
import { PairSelect } from './Modes';
import { dateTime, Feedback, message, Section, useLoad } from './ui';

const TONE: Record<PatternVerdict, string> = { can: '', review: 'warn', cannot: 'danger' };

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
  const [result, setResult] = useState<PatternTest | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function test() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [sourceLanguage, targetLanguage] = splitPair(pair);
      const response = await fetch(
        `/api/v1/document-patterns/test?sourceLanguage=${sourceLanguage}&targetLanguage=${targetLanguage}&mode=${mode}`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Protection': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
          body: file,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new ApiError(response.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Falha no teste');
      setResult(data as PatternTest);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
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
      <p className="muted small-text">O arquivo é analisado e traduzido só para o teste: nada é guardado e nenhuma tradução é criada.</p>
      <div className="filters">
        <button type="button" onClick={() => input.current?.click()}>
          {file ? file.name : 'Escolher arquivo'}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            event.target.value = '';
          }}
        />
        <PairSelect value={pair} onChange={setPair} />
        <select aria-label="Modalidade" value={mode} onChange={(e) => setMode(e.target.value as TranslationMode)}>
          {MODES.map((value) => (
            <option key={value} value={value}>
              {modeLabel[value]}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!file || busy} onClick={() => void test()}>
          {busy ? 'Testando…' : 'Testar'}
        </button>
      </div>
      <Feedback error={error} />
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
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import './pdf-polyfills';
import { message } from './ui';

/** Renders the actual PDF locally, including browsers without a built-in PDF plugin. */
export function PdfPreview({ url, title }: { url: string; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(380);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(160, Math.floor(entry.contentRect.width) - 24));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined;
    setDocument(null);
    setPage(1);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const pdf = await import('pdfjs-dist');
        if (cancelled) return;
        // Um worker só para todas as prévias, com os complementos carregados antes do PDF.js.
        pdf.GlobalWorkerOptions.workerPort ??= new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' });
        task = pdf.getDocument({ url, enableXfa: false });
        const loaded = await task.promise;
        if (!cancelled) setDocument(loaded);
      } catch (caught) {
        if (!cancelled) {
          setError(message(caught));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [url, attempt]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    setLoading(true);
    setError(null);
    setText('');
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const desiredScale = (width * zoom * ratio) / base.width;
        const scale = Math.min(desiredScale, Math.sqrt(6_000_000 / (base.width * base.height)));
        const viewport = pdfPage.getViewport({ scale });
        const target = canvas.current;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${Math.ceil(viewport.width / ratio)}px`;
        target.style.height = `${Math.ceil(viewport.height / ratio)}px`;
        render = pdfPage.render({ canvas: target, viewport });
        const [, content] = await Promise.all([render.promise, pdfPage.getTextContent()]);
        if (!cancelled) {
          setText(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
          setLoading(false);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(message(caught));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, page, zoom, width]);
  return (
    <div className="pdf-preview doc-pdf-preview" role="group" aria-label={title}>
      <div className="pdf-toolbar doc-pdf-toolbar">
        <button
          className="small"
          disabled={!document || page <= 1}
          onClick={() => setPage((n) => n - 1)}
          aria-label={`Página anterior de ${title}`}
        >
          ←
        </button>
        <span>{document ? `Página ${page} de ${document.numPages}` : 'Carregando páginas…'}</span>
        <button
          className="small"
          disabled={!document || page >= document.numPages}
          onClick={() => setPage((n) => n + 1)}
          aria-label={`Próxima página de ${title}`}
        >
          →
        </button>
        <select aria-label={`Zoom de ${title}`} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
          <option value={1}>Ajustar à largura</option>
          <option value={1.5}>150%</option>
          <option value={2}>200%</option>
        </select>
      </div>
      <div className="pdf-pages doc-pdf-pages" ref={container} aria-busy={loading}>
        {loading && (
          <p className="muted small-text" role="status">
            Renderizando página…
          </p>
        )}
        {error && (
          <div className="comparison-fallback">
            <p className="error-text" role="alert">
              Não foi possível renderizar a página: {error}
            </p>
            <button className="small" onClick={() => setAttempt((n) => n + 1)}>
              Tentar renderizar novamente
            </button>
          </div>
        )}
        <canvas ref={canvas} role="img" aria-label={`${title}, página ${page}`} hidden={!!error || !document} />
      </div>
      {text && (
        <details className="pdf-text doc-pdf-text">
          <summary>Texto desta página</summary>
          <p>{text}</p>
        </details>
      )}
    </div>
  );
}

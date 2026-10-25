import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, onRequestsInFlight, type Page } from './api';

export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Falha inesperada');

/** Comparação de texto sem acentos e sem diferenciar maiúsculas, para filtros locais. */
export const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Carrega dados e expõe recarga; erros viram mensagem exibível. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const scope = useMemo(() => Symbol('load'), deps);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loader = useRef(load);
  loader.current = load;
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ scope: symbol; data: T | null; error: string | null } | null>(null);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    loader
      .current()
      .then((data) => {
        if (active && currentScope.current === scope) setResult({ scope, data, error: null });
      })
      .catch((caught: unknown) => {
        if (active && currentScope.current === scope) setResult({ scope, data: null, error: message(caught) });
      });
    return () => {
      active = false;
    };
  }, [scope, version]);
  return { data: result?.scope === scope ? result.data : null, error: result?.scope === scope ? result.error : null, reload };
}

export function useDebounced<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function Feedback({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <div className="alert error" role="alert">
        {error}
      </div>
    );
  if (ok)
    return (
      <div className="alert success" role="status">
        {ok}
      </div>
    );
  return null;
}

/**
 * Marca: os colchetes das notas do tradutor ("[Assinatura ilegível]") com o traço de inutilização entre eles, a linha
 * que fecha o espaço em branco do documento juramentado.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <svg
        viewBox="0 0 28 34"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 2h12l7 7v23H5z" />
        <path d="M17 2v8h7M10 16h9M10 21h9M10 26h6" />
      </svg>
      <span>
        <strong>Tradutor Documental</strong>
        <small>Tradução pública</small>
      </span>
    </span>
  );
}

/** Dentro de uma área com abas, a seção não repete o título: a aba já diz onde a pessoa está. */
export const EmbeddedSection = createContext(false);

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const embedded = useContext(EmbeddedSection);
  return (
    <section className="section min-w-0">
      {embedded ? (
        subtitle && <p className="muted section-hint">{subtitle}</p>
      ) : (
        <header>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Grupo de opções exclusivas, usado como filtro rápido. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={value === key ? 'on' : ''}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <input type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" className="clear" aria-label="Limpar busca" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Lista paginada por cursor que recarrega quando os filtros mudam. `path` já traz a query string dos filtros;
 * o cursor é acrescentado aqui.
 */
export function usePaged<T>(path: string | null, version = 0) {
  const scope = `${path ?? ''}\u0000${version}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loadedScope = useRef<string | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (from: string | null) => {
      if (!path) return;
      if (from && busy.current) return;
      const ticket = ++sequence.current;
      busy.current = true;
      setLoading(true);
      try {
        const separator = path.includes('?') ? '&' : '?';
        const page = await api<Page<T>>('GET', from ? `${path}${separator}cursor=${encodeURIComponent(from)}` : path);
        if (ticket !== sequence.current || currentScope.current !== scope) return;
        loadedScope.current = scope;
        setItems((current) => (from ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        if (ticket === sequence.current && currentScope.current === scope) {
          loadedScope.current = scope;
          setError(message(caught));
        }
      } finally {
        if (ticket === sequence.current && currentScope.current === scope) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [path, scope],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setError(null);
    setLoading(false);
    busy.current = false;
    void load(null);
    return () => {
      ++sequence.current;
      busy.current = false;
    };
  }, [load]);

  const current = loadedScope.current === scope;
  return {
    items: current ? items : [],
    error: current ? error : null,
    loading: loading || (!!path && !current),
    hasMore: current && cursor !== null,
    more: () => {
      if (current && cursor) void load(cursor);
    },
    reload: () => void load(null),
  };
}

/** Botão "Carregar mais" e estado vazio de uma lista paginada. */
export function PagedFooter({
  hasMore,
  loading,
  onMore,
  empty,
  emptyText,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <>
      {empty && !loading && <p className="empty">{emptyText}</p>}
      {hasMore && (
        <button className="ghost" disabled={loading} onClick={onMore}>
          {loading ? <LoadingHint /> : 'Carregar mais'}
        </button>
      )}
    </>
  );
}

/** Período por datas (AAAA-MM-DD), inclusivo. */
export function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <fieldset className="date-range">
      <legend>{label}</legend>
      <input type="date" aria-label={`${label}: de`} value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
      <span className="muted">até</span>
      <input type="date" aria-label={`${label}: até`} value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
    </fieldset>
  );
}

/** Indicativo discreto de carregamento: a palavra e três pontos, sem caixa. */
export function LoadingHint({ text = 'Carregando' }: { text?: string }) {
  return (
    <span className="loading-hint" role="status">
      {text}
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </span>
  );
}

/** Linha fina sob a barra superior enquanto houver requisições em andamento (aparece só depois de 180 ms). */
export function LoadingLine() {
  const [busy, setBusy] = useState(false);
  useEffect(() => onRequestsInFlight((count) => setBusy(count > 0)), []);
  return <div className={`loading-line no-print ${busy ? 'on' : ''}`} aria-hidden="true" />;
}

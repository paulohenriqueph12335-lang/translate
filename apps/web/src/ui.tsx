import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Page } from './api';

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
      <svg viewBox="0 0 30 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square">
        <path d="M7 2H3v18h4" />
        <path d="M23 2h4v18h-4" />
        <path d="M10 11h3M15.5 11h4.5" />
      </svg>
      <span>
        <strong>Tradutor Documental</strong>
        <small>TRADUÇÃO PÚBLICA</small>
      </span>
    </span>
  );
}

/** Dentro de uma área com abas, a seção não repete o título: a aba já diz onde a pessoa está. */
export const EmbeddedSection = createContext(false);

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const embedded = useContext(EmbeddedSection);
  return (
    <section className="section">
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
          {loading ? 'Carregando…' : 'Carregar mais'}
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

/** Etiquetas como fichas; com `onRemove`, cada uma pode ser retirada. */
export function TagList({ tags, onRemove, onPick }: { tags: string[]; onRemove?: (tag: string) => void; onPick?: (tag: string) => void }) {
  if (!tags.length) return null;
  return (
    <span className="tags">
      {tags.map((tag) =>
        onRemove ? (
          <span key={tag} className="tag">
            {tag}
            <button type="button" aria-label={`Remover etiqueta ${tag}`} onClick={() => onRemove(tag)}>
              ×
            </button>
          </span>
        ) : onPick ? (
          <button key={tag} type="button" className="tag pick" onClick={() => onPick(tag)} title="Filtrar por esta etiqueta">
            {tag}
          </button>
        ) : (
          <span key={tag} className="tag">
            {tag}
          </span>
        ),
      )}
    </span>
  );
}

/** Campo de etiquetas: Enter ou vírgula adiciona; sugere as etiquetas já usadas. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  max = 10,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  max?: number;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const tag = raw.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').slice(0, 40);
    if (tag && !value.includes(tag) && value.length < max) onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div className="tag-input">
      <TagList tags={value} onRemove={(tag) => onChange(value.filter((item) => item !== tag))} />
      {value.length < max && (
        <input
          list={listId}
          placeholder={value.length ? 'Outra etiqueta…' : 'Ex.: histórico escolar, certidão, urgente'}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
        />
      )}
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !value.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}

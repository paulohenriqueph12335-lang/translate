import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface DashboardWidget {
  id: string;
  title: string;
  content: ReactNode;
  wide?: boolean;
  defaultVisible?: boolean;
}
interface Preferences {
  order: string[];
  visible: string[];
}

function readPreferences(key: string | null, widgets: DashboardWidget[]): Preferences {
  const fallback = { order: widgets.map((w) => w.id), visible: widgets.filter((w, i) => w.defaultVisible ?? i < 2).map((w) => w.id) };
  if (!key) return fallback;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const saved = raw as Partial<Preferences>;
    if (!Array.isArray(saved.order) || !Array.isArray(saved.visible)) return fallback;
    const ids = new Set(fallback.order);
    return {
      order: [...new Set([...saved.order.filter((id): id is string => typeof id === 'string' && ids.has(id)), ...fallback.order])],
      visible: [...new Set(saved.visible.filter((id): id is string => typeof id === 'string' && ids.has(id)))],
    };
  } catch {
    return fallback;
  }
}

/** Optional dashboards keep the essential KPI strip visible; preferences are private to this browser and user. */
export function DashboardWidgets({
  userId,
  namespace,
  children,
  widgets: supplied,
  revealId,
}: {
  userId?: string | undefined;
  namespace: string;
  children?: ReactNode;
  widgets?: DashboardWidget[];
  revealId?: string | undefined;
}) {
  const widgets: DashboardWidget[] =
    supplied ??
    Children.toArray(children).flatMap((child, index) => {
      if (!isValidElement<{ title?: string; wide?: boolean }>(child)) return [];
      const title = child.props.title ?? `Painel ${index + 1}`;
      return [
        {
          id: title
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-'),
          title,
          content: child,
          wide: child.props.wide ?? false,
        },
      ];
    });
  const key = userId ? `tradutor.dashboard.v1.${userId}.${namespace}` : null;
  const [preferences, setPreferences] = useState(() => readPreferences(key, widgets));
  const [expanded, setExpanded] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const signature = widgets.map((w) => w.id).join('|');
  useEffect(() => {
    setPreferences(readPreferences(key, widgets));
    setExpanded(null);
  }, [key, signature]);
  useEffect(() => {
    if (revealId && widgets.some((w) => w.id === revealId))
      setPreferences((p) => (p.visible.includes(revealId) ? p : { ...p, visible: [...p.visible, revealId] }));
  }, [revealId, key, signature]);
  useEffect(() => {
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify(preferences));
      } catch {
        /* The dashboard remains usable with blocked storage. */
      }
    }
  }, [key, preferences]);
  useEffect(() => {
    const node = dialog.current;
    if (expanded && node && !node.open) node.showModal();
  }, [expanded]);
  const ordered = preferences.order.flatMap((id) => {
    const w = widgets.find((item) => item.id === id);
    return w ? [w] : [];
  });
  const visible = ordered.filter((w) => preferences.visible.includes(w.id));
  const selected = widgets.find((w) => w.id === expanded);
  const toggle = (id: string) =>
    setPreferences((p) => ({ ...p, visible: p.visible.includes(id) ? p.visible.filter((x) => x !== id) : [...p.visible, id] }));
  const move = (id: string, delta: number) =>
    setPreferences((p) => {
      const order = [...p.order];
      const index = order.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= order.length) return p;
      [order[index], order[next]] = [order[next]!, order[index]!];
      return { ...p, order };
    });
  const controls = (widget: DashboardWidget) => (
    <div className="dashboard-widget-controls no-print" aria-label={`Organizar ${widget.title}`}>
      <button type="button" className="small" onClick={() => setExpanded(widget.id)} aria-label={`Ampliar ${widget.title}`}>
        Ampliar
      </button>
      <button
        type="button"
        className="small"
        onClick={() => move(widget.id, -1)}
        disabled={preferences.order[0] === widget.id}
        aria-label={`Mover ${widget.title} para antes`}
      >
        ↑
      </button>
      <button
        type="button"
        className="small"
        onClick={() => move(widget.id, 1)}
        disabled={preferences.order.at(-1) === widget.id}
        aria-label={`Mover ${widget.title} para depois`}
      >
        ↓
      </button>
      <button type="button" className="small" onClick={() => toggle(widget.id)} aria-label={`Ocultar ${widget.title}`}>
        Ocultar
      </button>
    </div>
  );
  return (
    <div className="dashboard-workspace">
      <details className="dashboard-picker no-print">
        <summary>
          Escolher painéis{' '}
          <span className="muted">
            ({visible.length} de {widgets.length})
          </span>
        </summary>
        <p className="muted small-text">
          Os indicadores principais ficam sempre visíveis. Sua seleção e ordem são salvas neste navegador, para sua conta.
        </p>
        <div className="dashboard-picker-options">
          {ordered.map((w) => (
            <label className="check" key={w.id}>
              <input type="checkbox" checked={preferences.visible.includes(w.id)} onChange={() => toggle(w.id)} />
              {w.title}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="small"
          onClick={() =>
            setPreferences({
              order: widgets.map((w) => w.id),
              visible: widgets.filter((w, i) => w.defaultVisible ?? i < 2).map((w) => w.id),
            })
          }
        >
          Restaurar painéis principais
        </button>
      </details>
      <div className="chart-grid dashboard-widget-grid">
        {visible.map((w) => (
          <div key={w.id} className={`dashboard-widget ${w.wide ? 'wide' : ''}`}>
            {controls(w)}
            {expanded === w.id ? <div className="dashboard-print-only">{w.content}</div> : w.content}
            {expanded === w.id && <p className="dashboard-expanded-placeholder no-print">Este painel está aberto na janela ampliada.</p>}
          </div>
        ))}
      </div>
      {!visible.length && <p className="empty no-print">Escolha os painéis que deseja consultar no menu acima.</p>}
      {selected && (
        <dialog
          ref={dialog}
          className="dashboard-dialog no-print"
          aria-labelledby={titleId}
          onCancel={() => setExpanded(null)}
          onClose={() => setExpanded(null)}
        >
          <div className="dashboard-dialog-header">
            <h2 id={titleId}>{selected.title}</h2>
            <button
              type="button"
              autoFocus
              onClick={() => {
                dialog.current?.close();
                setExpanded(null);
              }}
            >
              Fechar janela
            </button>
          </div>
          {selected.content}
        </dialog>
      )}
    </div>
  );
}

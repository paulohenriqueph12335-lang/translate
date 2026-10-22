import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { api, auditActionLabel, queryString, type AuditEvent, type OrganizationDashboard, type Page, type TeamDashboard } from './api';
import { duration, INK_BLUE, percent, SEPIA, TableView } from './Charts';
import { message } from './ui';

/**
 * Peças dos painéis (Início): período com atalhos e comparação, números com variação, tendência semanal, funil do
 * fluxo, mapa de calor pessoa × semana e o monitor "Agora". Tudo calculado no navegador a partir dos painéis da API.
 *
 * Cor (dataviz, validado): azul-caneta = período atual / série 1, sépia-carimbo = período anterior / série 2;
 * sequencial em azul-caneta; estados com as cores de estado.
 */
/** Rampa sequencial de um tom (claro → escuro) para o mapa de calor. */
const RAMP = ['#e9eef6', '#c6d3e8', '#93acd2', '#5a80b7', '#2f5a96', '#1d3d6b'];

// ---------- Período ----------

export interface Range {
  from: string;
  to: string;
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parse = (value: string) => new Date(`${value}T00:00:00`);
const addDays = (value: string, days: number) => {
  const date = parse(value);
  date.setDate(date.getDate() + days);
  return iso(date);
};
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
export const shortDate = (value: string) => parse(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const longDate = (value: string) => parse(value).toLocaleDateString('pt-BR');

/** O período anterior de mesmo tamanho, terminando na véspera do atual. */
export const previousRange = (range: Range): Range => {
  const length = daysBetween(range.from, range.to);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -length), to };
};

const PRESETS: Array<[string, string, number]> = [
  ['7', '7 dias', 7],
  ['30', '30 dias', 30],
  ['90', '90 dias', 90],
  ['365', '12 meses', 365],
];

export interface PeriodState {
  range: Range;
  previous: Range;
  compare: boolean;
}

export function usePeriodFilter(initialDays = 30) {
  const today = iso(new Date());
  const [preset, setPreset] = useState(String(initialDays));
  const [custom, setCustom] = useState<Range>({ from: addDays(today, -(initialDays - 1)), to: today });
  const [compare, setCompare] = useState(true);
  const days = PRESETS.find(([key]) => key === preset)?.[2];
  const range: Range = days ? { from: addDays(today, -(days - 1)), to: today } : custom;
  const state: PeriodState = { range, previous: previousRange(range), compare };

  const control = (
    <div className="period-filter">
      <div className="segmented" role="radiogroup" aria-label="Período">
        {PRESETS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={preset === key}
            className={preset === key ? 'on' : ''}
            onClick={() => setPreset(key)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={preset === 'custom'}
          className={preset === 'custom' ? 'on' : ''}
          onClick={() => {
            setCustom(range);
            setPreset('custom');
          }}
        >
          Datas
        </button>
      </div>
      {preset === 'custom' && (
        <span className="period-custom">
          <input
            type="date"
            aria-label="De"
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
          />
          <span className="muted">até</span>
          <input
            type="date"
            aria-label="Até"
            value={custom.to}
            min={custom.from}
            max={today}
            onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
          />
        </span>
      )}
      <label className="check compare-toggle">
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Comparar com o período anterior
      </label>
    </div>
  );
  return { state, control };
}

export const periodText = (range: Range) => `${longDate(range.from)} a ${longDate(range.to)}`;

// ---------- Dados ----------

/** Carrega sem piscar: enquanto atualiza, o desenho anterior fica, esmaecido. */
export function useStableLoad<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const run = useCallback(() => {
    let alive = true;
    setLoading(true);
    loader
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((caught: unknown) => alive && setError(message(caught)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(run, [key, run]);
  return { data, error, loading, reload: run };
}

export interface Insight {
  org: OrganizationDashboard | null;
  teams: TeamDashboard[];
}

export function loadInsight(range: Range, teamIds: string[], withOrg: boolean, orgTeamId?: string): Promise<Insight> {
  const query = { from: range.from, to: range.to };
  return Promise.all([
    withOrg ? api<OrganizationDashboard>('GET', `/dashboards/organization${queryString({ ...query, teamId: orgTeamId })}`) : null,
    Promise.all(teamIds.map((teamId) => api<TeamDashboard>('GET', `/dashboards/team${queryString({ ...query, teamId })}`))),
  ]).then(([org, teams]) => ({ org, teams }));
}

type Doc = TeamDashboard['documents'][number];
export const docsOf = (insight: Insight | null) => insight?.teams.flatMap((team) => team.documents) ?? [];
const inRange = (value: string | null, range: Range) => !!value && value.slice(0, 10) >= range.from && value.slice(0, 10) <= range.to;
const localDay = (value: string) => iso(new Date(value));

/** Semanas (início na segunda-feira) que cobrem o período. */
export function weeksOf(range: Range) {
  const first = parse(range.from);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const weeks: string[] = [];
  for (let week = iso(first); week <= range.to; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}
const weekOf = (day: string) => {
  const date = parse(day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return iso(date);
};

/** Recebidas e concluídas por semana, a partir dos documentos das equipes. */
export function weeklySeries(docs: Doc[], range: Range) {
  const weeks = weeksOf(range);
  const received = new Map(weeks.map((week) => [week, 0]));
  const approved = new Map(weeks.map((week) => [week, 0]));
  for (const doc of docs) {
    if (inRange(doc.createdAt, range)) {
      const week = weekOf(localDay(doc.createdAt));
      received.set(week, (received.get(week) ?? 0) + 1);
    }
    if (doc.approvedAt && inRange(doc.approvedAt, range)) {
      const week = weekOf(localDay(doc.approvedAt));
      approved.set(week, (approved.get(week) ?? 0) + 1);
    }
  }
  return { weeks, received: weeks.map((week) => received.get(week) ?? 0), approved: weeks.map((week) => approved.get(week) ?? 0) };
}

// ---------- Número com variação ----------

/** Variação contra o período anterior; `better` diz se subir é bom (tempo menor é melhor). */
export function KpiTile({
  label,
  value,
  current,
  previous,
  better = 'up',
  detail,
  compare,
  format = (n: number) => n.toLocaleString('pt-BR'),
}: {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  better?: 'up' | 'down';
  detail?: string;
  compare: boolean;
  format?: (n: number) => string;
}) {
  let delta: ReactNode = null;
  if (compare && current !== null && previous !== null) {
    if (previous === 0 && current === 0) delta = <span className="delta flat">igual ao período anterior</span>;
    else if (previous === 0) delta = <span className="delta flat">sem base no período anterior</span>;
    else {
      const change = Math.round(((current - previous) / previous) * 100);
      const up = change > 0;
      const good = change === 0 ? null : up ? better === 'up' : better === 'down';
      delta = (
        <span className={`delta ${good === null ? 'flat' : good ? 'good' : 'bad'}`}>
          {change !== 0 && (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d={up ? 'M5 1.5 9 7.5H1z' : 'M5 8.5 1 2.5h8z'} />
            </svg>
          )}
          <strong>{change === 0 ? '0%' : `${up ? '+' : '−'}${Math.abs(change)}%`}</strong>
          <span>vs. anterior ({format(previous)})</span>
        </span>
      );
    }
  }
  return (
    <div className="card kpi-tile">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {delta}
      {detail && <span className="muted small-text">{detail}</span>}
    </div>
  );
}

// ---------- Tendência ----------

interface Series {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/** Linha por semana com cursor: a linha vertical acha a semana e a dica lista todas as séries. */
export function TrendChart({ labels, series, unit = '' }: { labels: string[]; series: Series[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const pad = { top: 16, right: 40, bottom: 28, left: 36 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const niceMax = Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW);
  const y = (value: number) => pad.top + plotH - (value / niceMax) * plotH;
  const ticks = [0, 0.5, 1].map((share) => Math.round(niceMax * share));
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const index = Math.round(((px - pad.left) / plotW) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, index)));
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'ArrowRight') setHover((current) => Math.min(labels.length - 1, (current ?? -1) + 1));
    if (event.key === 'ArrowLeft') setHover((current) => Math.max(0, (current ?? labels.length) - 1));
  };
  if (!labels.length) return <p className="empty">Sem semanas no período.</p>;
  return (
    <div className="chart trend">
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <svg viewBox="0 0 18 4" aria-hidden="true">
              <line x1="0" y1="2" x2="18" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="trend-svg"
        role="img"
        aria-label={`Tendência por semana: ${series.map((s) => s.name).join(', ')}. Use as setas para percorrer as semanas.`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((current) => current ?? labels.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={key}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.left - 8} y={y(tick) + 4} className="axis" textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          labels.length <= 8 || index % Math.ceil(labels.length / 8) === 0 || index === labels.length - 1 ? (
            <text key={label} x={x(index)} y={height - 8} className="axis" textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? '6 5' : undefined}
              strokeLinejoin="round"
              className="trend-line"
            />
            {/* Rótulo direto só no último ponto da série atual. */}
            {!s.dashed && s.values.length > 0 && (
              <text x={x(s.values.length - 1) + 8} y={y(s.values.at(-1)!) + 4} className="direct-label" textAnchor="start">
                {s.values.at(-1)}
                {unit}
              </text>
            )}
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} className="crosshair" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={s.color} className="trend-dot" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip trend-tip"
          style={{
            left: `${(x(hover) / width) * 100}%`,
            transform: hover >= (labels.length - 1) / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          }}
          role="status"
        >
          <span className="tip-head">Semana de {labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="tip-row">
              <svg viewBox="0 0 14 4" aria-hidden="true">
                <line x1="0" y1="2" x2="14" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '3 2' : undefined} />
              </svg>
              <strong>
                {s.values[hover] ?? 0}
                {unit}
              </strong>
              {/* "Concluídas · período atual" → só "período atual": a medida já está no título do cartão. */}
              <span>{s.name.split(' · ').at(-1)}</span>
            </span>
          ))}
        </div>
      )}
      <TableView
        head={['Semana', ...series.map((s) => s.name)]}
        rows={labels.map((label, index) => [label, ...series.map((s) => s.values[index] ?? 0)])}
      />
    </div>
  );
}

// ---------- Funil ----------

export interface FunnelStep {
  label: string;
  hint: string;
  count: number;
}

/** Etapas do fluxo a partir dos documentos recebidos no período. */
export function funnelOf(docs: Doc[], range: Range): FunnelStep[] {
  const received = docs.filter((doc) => inRange(doc.createdAt, range));
  const translated = received.filter((doc) => !['queued', 'processing', 'failed', 'cancelled'].includes(doc.status));
  const ready = received.filter((doc) => doc.status === 'awaiting_approval' || doc.status === 'approved');
  const approved = received.filter((doc) => doc.status === 'approved');
  return [
    { label: 'Recebidas', hint: 'documentos enviados no período', count: received.length },
    { label: 'Traduzidas', hint: 'saíram da tradução e da revisão automática', count: translated.length },
    { label: 'Prontas', hint: 'marcadas como prontas para concluir', count: ready.length },
    { label: 'Concluídas', hint: 'numeradas, com o Word final', count: approved.length },
  ];
}

/** Funil horizontal: quantidade e conversão de cada etapa; a maior perda fica marcada. */
export function Funnel({ steps, previous }: { steps: FunnelStep[]; previous: FunnelStep[] | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, steps[0]?.count ?? 0);
  const losses = steps.slice(1).map((step, index) => ({ at: index + 1, lost: steps[index]!.count - step.count }));
  const worst = losses.reduce<{ at: number; lost: number } | null>((best, loss) => (loss.lost > (best?.lost ?? 0) ? loss : best), null);
  if (!steps[0]?.count) return <p className="empty">Nenhum documento recebido no período.</p>;
  return (
    <div className="chart funnel">
      {steps.map((step, index) => {
        const prev = index ? steps[index - 1]! : null;
        const rate = prev ? percent(step.count, prev.count) : 100;
        const leak = worst?.at === index;
        return (
          <div key={step.label} className="funnel-step">
            {prev && (
              <div className={`funnel-drop ${leak ? 'leak' : ''}`}>
                <span>
                  {rate}% seguiram
                  {prev.count - step.count > 0 && ` · ${prev.count - step.count} ficaram em ${prev.label.toLowerCase()}`}
                </span>
                {leak && <strong>[maior perda]</strong>}
              </div>
            )}
            <div
              className={`funnel-row ${hover === index ? 'on' : ''}`}
              tabIndex={0}
              onPointerEnter={() => setHover(index)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
            >
              <span className="funnel-label">
                <strong>{step.label}</strong>
                <span className="muted small-text">{step.hint}</span>
              </span>
              <span className="funnel-track">
                <span
                  className="funnel-bar"
                  style={{ width: `${Math.max(2, (step.count / top) * 100)}%`, background: leak ? SEPIA : INK_BLUE }}
                />
              </span>
              <span className="funnel-value">
                <strong>{step.count}</strong>
                <span className="muted small-text">{percent(step.count, top)}% do total</span>
              </span>
            </div>
          </div>
        );
      })}
      {worst && worst.lost > 0 && (
        <p className="funnel-note">
          A maior perda está entre <strong>{steps[worst.at - 1]!.label}</strong> e <strong>{steps[worst.at]!.label}</strong>: {worst.lost}{' '}
          documento(s) ainda não passaram dessa etapa.
        </p>
      )}
      <TableView
        head={previous ? ['Etapa', 'Atual', 'Conversão', 'Anterior', 'Conversão anterior'] : ['Etapa', 'Quantidade', 'Conversão']}
        rows={steps.map((step, index) => {
          const rate = index ? `${percent(step.count, steps[index - 1]!.count)}%` : '100%';
          if (!previous) return [step.label, step.count, rate];
          const old = previous[index]!;
          const oldRate = index ? `${percent(old.count, previous[index - 1]!.count)}%` : '100%';
          return [step.label, step.count, rate, old.count, oldRate];
        })}
      />
    </div>
  );
}

// ---------- Mapa de calor ----------

type HeatMetric = 'delivered' | 'review';

/** Pessoa × semana: concluídas ou tempo médio de revisão, em um tom de azul do claro ao escuro. */
export function PeopleHeatmap({ docs, range }: { docs: Doc[]; range: Range }) {
  const [metric, setMetric] = useState<HeatMetric>('delivered');
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const weeks = weeksOf(range);
  const cells = new Map<string, { count: number; review: number[] }>();
  const people = new Set<string>();
  for (const doc of docs) {
    if (!doc.approvedAt || !doc.assignee || !inRange(doc.approvedAt, range)) continue;
    people.add(doc.assignee);
    const key = `${doc.assignee}|${weekOf(localDay(doc.approvedAt))}`;
    const cell = cells.get(key) ?? { count: 0, review: [] };
    cell.count += 1;
    if (doc.reviewMinutes !== null) cell.review.push(doc.reviewMinutes);
    cells.set(key, cell);
  }
  const value = (person: string, week: string) => {
    const cell = cells.get(`${person}|${week}`);
    if (!cell) return null;
    if (metric === 'delivered') return cell.count;
    return cell.review.length ? Math.round(cell.review.reduce((a, b) => a + b, 0) / cell.review.length) : null;
  };
  const rows = [...people].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const values = rows.flatMap((person) => weeks.map((week) => value(person, week))).filter((v): v is number => v !== null);
  const max = Math.max(1, ...values);
  const step = (v: number) => Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1) + 0.0001));
  const format = (v: number | null) => (v === null ? '—' : metric === 'delivered' ? String(v) : duration(v));
  if (!rows.length) return <p className="empty">Nenhuma tradução concluída com responsável no período.</p>;
  return (
    <div className="chart heatmap" onPointerLeave={() => setTip(null)}>
      <div className="heat-head">
        <div className="segmented" role="radiogroup" aria-label="Medida do mapa">
          {(
            [
              ['delivered', 'Concluídas'],
              ['review', 'Revisão média'],
            ] as Array<[HeatMetric, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={metric === key}
              className={metric === key ? 'on' : ''}
              onClick={() => setMetric(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="heat-legend" aria-label="Escala de cor">
          <span>{metric === 'delivered' ? 'menos' : 'mais rápida'}</span>
          {RAMP.map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
          <span>{metric === 'delivered' ? 'mais' : 'mais lenta'}</span>
        </span>
      </div>
      <div className="heat-scroll">
        <table className="heat-grid">
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              {weeks.map((week) => (
                <th key={week} scope="col">
                  {shortDate(week)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person}>
                <th scope="row">{person}</th>
                {weeks.map((week) => {
                  const v = value(person, week);
                  const s = v === null ? -1 : step(v);
                  const text = `${person} · semana de ${shortDate(week)}: ${format(v)}${metric === 'delivered' && v !== null ? ' concluída(s)' : ''}`;
                  return (
                    <td
                      key={week}
                      tabIndex={0}
                      aria-label={text}
                      className={s >= 3 ? 'dark' : ''}
                      style={{ background: s < 0 ? undefined : RAMP[s] }}
                      onPointerMove={(event) => {
                        const box = (event.currentTarget.closest('.heatmap') as HTMLElement).getBoundingClientRect();
                        setTip({ text, x: event.clientX - box.left, y: event.clientY - box.top });
                      }}
                    >
                      {v === null ? '' : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="status">
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ---------- Agora (ao vivo) ----------

const LIVE_MS = 15_000;
const STAGES: Array<[string, string]> = [
  ['queued,processing', 'Processando'],
  ['in_review', 'Para revisar'],
  ['awaiting_approval', 'Aguardando conclusão'],
  ['failed', 'Com falha'],
];

/** Fila agora: quantos documentos em cada etapa, atualizado a cada 15 s, com histórico curto e os últimos eventos. */
export function LiveNow({ teamId, canReadAudit }: { teamId?: string | undefined; canReadAudit: boolean }) {
  const [paused, setPaused] = useState(false);
  const [counts, setCounts] = useState<number[] | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const tick = async () => {
      try {
        const results = await Promise.all(
          STAGES.map(([status]) =>
            api<Page<unknown>>('GET', `/translations${queryString({ status, teamId, limit: 100 })}`).then((page) => page.items.length),
          ),
        );
        const recent = canReadAudit
          ? await api<Page<AuditEvent>>('GET', `/audit-events${queryString({ category: 'translation', teamId, limit: 6 })}`).catch(
              () => null,
            )
          : null;
        if (!alive) return;
        setCounts(results);
        setHistory((current) => [...current, results.slice(0, 3).reduce((a, b) => a + b, 0)].slice(-40));
        if (recent) setEvents(recent.items);
        setUpdated(new Date());
        setError(null);
      } catch (caught) {
        if (alive) setError(message(caught));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), LIVE_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [paused, teamId, canReadAudit]);

  const inFlight = counts ? counts.slice(0, 3).reduce((a, b) => a + b, 0) : null;
  const sparkMax = Math.max(1, ...history);
  return (
    <section className="card live-now" aria-label="Fila agora">
      <header className="live-head">
        <span className={`live-dot ${paused ? 'paused' : ''}`} aria-hidden="true" />
        <h3>Agora</h3>
        <span className="muted small-text">
          {paused ? 'Atualização pausada' : updated ? `Atualizado às ${updated.toLocaleTimeString('pt-BR')} · a cada 15 s` : 'Carregando…'}
        </span>
        <button type="button" className="small" onClick={() => setPaused((current) => !current)}>
          {paused ? 'Retomar' : 'Pausar'}
        </button>
      </header>
      {error && <p className="error-text small-text">{error}</p>}
      <div className="live-body">
        <div className="live-total">
          <strong>{inFlight ?? '—'}</strong>
          <span className="muted small-text">em andamento</span>
          <svg viewBox="0 0 120 32" className="spark" role="img" aria-label="Documentos em andamento nas últimas leituras">
            {history.length > 1 && (
              <path
                d={history.map((v, i) => `${i ? 'L' : 'M'}${(i / (history.length - 1)) * 118 + 1},${31 - (v / sparkMax) * 28}`).join(' ')}
                fill="none"
                stroke={INK_BLUE}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            )}
            {history.length > 0 && (
              <circle cx={history.length > 1 ? 119 : 60} cy={31 - (history.at(-1)! / sparkMax) * 28} r="3" fill={INK_BLUE} />
            )}
          </svg>
        </div>
        <ul className="live-stages">
          {STAGES.map(([status, label], index) => (
            <li key={status} className={status === 'failed' && (counts?.[index] ?? 0) > 0 ? 'alarm' : ''}>
              <strong>{counts ? (counts[index]! >= 100 ? '100+' : counts[index]) : '—'}</strong>
              <span>{label}</span>
            </li>
          ))}
        </ul>
        {canReadAudit && (
          <ol className="live-events" aria-label="Últimos eventos">
            {events.length === 0 && <li className="muted small-text">Nenhum evento recente.</li>}
            {events.map((event) => (
              <li key={event.id} className="live-event">
                <time className="mono">
                  {new Date(event.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </time>
                <span>
                  {auditActionLabel[event.action] ?? event.action}
                  {event.actor?.displayName ? (
                    <span className="muted"> · {event.actor.displayName}</span>
                  ) : (
                    <span className="muted"> · sistema</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

import { useState, type MouseEvent, type ReactNode } from 'react';

/**
 * Gráficos dos painéis, em SVG/HTML simples. Paleta categórica validada (dataviz: azul, laranja, água, nessa ordem);
 * sequencial em azul. Toda série tem legenda ou rótulo direto, dica ao passar o mouse e tabela equivalente.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
const OTHER = '#9a9893';

type Tip = { x: number; y: number; text: string } | null;

/** Dica que acompanha o mouse dentro do gráfico. */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (text: string) => (event: MouseEvent) => {
    const box = (event.currentTarget as Element).closest('.chart')!.getBoundingClientRect();
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, text });
  };
  const view = tip && (
    <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="status">
      {tip.text}
    </div>
  );
  return { show, hide: () => setTip(null), view };
}

export const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
const number = (value: number) => value.toLocaleString('pt-BR');

/** Tabela equivalente ao gráfico, recolhida por padrão. */
export function TableView({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="chart-table">
      <summary>Ver tabela</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={cell}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, i) => (
                  <td key={i}>{typeof cell === 'number' ? number(cell) : cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className={`card chart-card ${wide ? 'wide' : ''}`}>
      <figcaption>
        <h3>{title}</h3>
        {subtitle && <p className="muted small-text">{subtitle}</p>}
      </figcaption>
      {children}
    </figure>
  );
}

/** Número em destaque, com contexto curto. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="card stat-tile">
      <span className="muted small-text">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="muted small-text">{detail}</span>}
    </div>
  );
}

/** Barras horizontais ordenadas (uma série): o rótulo fica à esquerda e o valor na ponta. */
export function RankedBars({ items, unit = '' }: { items: Array<{ label: string; value: number }>; unit?: string }) {
  const tip = useTip();
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <p className="empty">Sem dados no período.</p>;
  return (
    <div className="chart ranked" onMouseLeave={tip.hide}>
      {items.map((item) => (
        <div key={item.label} className="ranked-row" onMouseMove={tip.show(`${item.label}: ${number(item.value)}${unit}`)}>
          <span className="ranked-label" title={item.label}>
            {item.label}
          </span>
          <span className="ranked-track">
            <span className="bar-h" style={{ width: `${(item.value / max) * 100}%`, background: SERIES[0] }} />
            <span className="bar-value">
              {number(item.value)}
              {unit}
            </span>
          </span>
        </div>
      ))}
      {tip.view}
      <TableView head={['Item', 'Quantidade']} rows={items.map((item) => [item.label, item.value])} />
    </div>
  );
}

/** Barras 100% empilhadas por linha (até 3 partes), com legenda; % no segmento só quando cabe. */
export function StackedShare({ rows, parts }: { rows: Array<{ label: string; values: number[] }>; parts: string[] }) {
  const tip = useTip();
  if (!rows.length) return <p className="empty">Sem dados no período.</p>;
  return (
    <div className="chart stacked" onMouseLeave={tip.hide}>
      <div className="legend">
        {parts.map((part, index) => (
          <span key={part}>
            <i style={{ background: SERIES[index] }} /> {part}
          </span>
        ))}
      </div>
      {rows.map((row) => {
        const total = row.values.reduce((sum, value) => sum + value, 0);
        return (
          <div key={row.label} className="ranked-row">
            <span className="ranked-label" title={row.label}>
              {row.label}
            </span>
            <span className="stack-track">
              {row.values.map((value, index) =>
                value ? (
                  <span
                    key={index}
                    className="stack-seg"
                    style={{ width: `${(value / total) * 100}%`, background: SERIES[index] }}
                    onMouseMove={tip.show(`${row.label} · ${parts[index]}: ${number(value)} (${percent(value, total)}%)`)}
                  >
                    {percent(value, total) >= 18 ? `${percent(value, total)}%` : ''}
                  </span>
                ) : null,
              )}
            </span>
            <span className="bar-value">{number(total)}</span>
          </div>
        );
      })}
      {tip.view}
      <TableView
        head={['Tipo', ...parts.map((part) => `${part} (%)`), 'Total']}
        rows={rows.map((row) => {
          const total = row.values.reduce((sum, value) => sum + value, 0);
          return [row.label, ...row.values.map((value) => `${number(value)} (${percent(value, total)}%)`), total];
        })}
      />
    </div>
  );
}

/** Rosca de participação: até 3 fatias nomeadas, o resto vira "Outros". Rótulos diretos com %. */
export function Donut({ items }: { items: Array<{ label: string; value: number }> }) {
  const tip = useTip();
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const slices =
    sorted.length > 3 ? [...sorted.slice(0, 2), { label: 'Outros', value: sorted.slice(2).reduce((s, i) => s + i.value, 0) }] : sorted;
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <p className="empty">Sem dados no período.</p>;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="chart donut" onMouseLeave={tip.hide}>
      <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Participação por idioma">
        {slices.map((slice, index) => {
          const length = (slice.value / total) * circumference;
          // 2px de superfície separando as fatias.
          const gap = slices.length > 1 ? 2 : 0;
          const circle = (
            <circle
              key={slice.label}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={slice.label === 'Outros' ? OTHER : SERIES[index]}
              strokeWidth="22"
              strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              onMouseMove={tip.show(`${slice.label}: ${number(slice.value)} (${percent(slice.value, total)}%)`)}
            />
          );
          offset += length;
          return circle;
        })}
        <text x="70" y="66" textAnchor="middle" className="donut-total">
          {number(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="donut-caption">
          concluídas
        </text>
      </svg>
      <ul className="donut-legend">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <i style={{ background: slice.label === 'Outros' ? OTHER : SERIES[index] }} />
            <span>{slice.label}</span>
            <strong>{percent(slice.value, total)}%</strong>
            <span className="muted">{number(slice.value)}</span>
          </li>
        ))}
      </ul>
      {tip.view}
    </div>
  );
}

/** Colunas no tempo (uma série), valor só no maior e no último. */
export function Columns({ items }: { items: Array<{ label: string; value: number }> }) {
  const tip = useTip();
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <p className="empty">Sem dados no período.</p>;
  const peak = items.reduce((best, item, index) => (item.value > items[best]!.value ? index : best), 0);
  return (
    <div className="chart columns" onMouseLeave={tip.hide}>
      <div className="columns-plot">
        {items.map((item, index) => (
          <div key={item.label} className="column-slot" onMouseMove={tip.show(`Semana de ${item.label}: ${number(item.value)}`)}>
            <span className="column-value">{index === peak || index === items.length - 1 ? number(item.value) : ''}</span>
            <span className="bar-v" style={{ height: `${(item.value / max) * 100}%`, background: SERIES[0] }} />
            <span className="column-label">{item.label}</span>
          </div>
        ))}
      </div>
      {tip.view}
      <TableView head={['Semana', 'Concluídas']} rows={items.map((item) => [item.label, item.value])} />
    </div>
  );
}

/** Uso de cota: barra de progresso com estado textual (nunca só cor). */
export function Meter({ used, quota }: { used: number; quota: number | null }) {
  if (quota === null) return <span className="muted small-text">{number(used)} usados · sem limite</span>;
  const share = Math.min(100, percent(used, quota));
  const state = used >= quota ? 'full' : share >= 80 ? 'warn' : 'ok';
  return (
    <span className={`meter ${state}`} title={`${used} de ${quota}`}>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${share}%` }} />
      </span>
      <span className="small-text">
        {number(used)}/{number(quota)}
        {state === 'full' ? ' · esgotada' : state === 'warn' ? ' · acima de 80%' : ''}
      </span>
    </span>
  );
}

/** Minutos legíveis: 45 min, 3 h 10 min, 2 d 4 h. */
export function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.round((minutes % (60 * 24)) / 60);
  return `${days} d${hours ? ` ${hours} h` : ''}`;
}

/** Baixa linhas como CSV (relatório), com BOM para o Excel abrir acentos certos. */
export function downloadCsv(name: string, head: string[], rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [head, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

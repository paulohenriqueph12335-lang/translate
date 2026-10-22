import { useEffect, useState } from 'react';
import { api, queryString, type AiComparison as Comparison, type AiComparisonPoint, type AiStatus, type Me, type Team } from './api';
import { ChartCard, downloadCsv, duration, PairedColumns, percent, SERIES } from './Charts';
import { DateRange, Feedback, message, Segmented, useLoad } from './ui';

/**
 * Escolha da pessoa entre trabalhar com ou sem IA (ADR-022). Fica em Meu workspace; cada troca vai para a auditoria e
 * vale para os protocolos criados daqui em diante.
 */
export function AiChoice() {
  const status = useLoad(() => api<AiStatus>('GET', '/ai/status'), []);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const data = status.data;
  if (!data) return null;

  async function choose(useAi: boolean) {
    if (useAi === data!.useAi) return;
    setSaving(true);
    setFeedback({});
    try {
      await api('PUT', '/ai/choice', { useAi });
      setFeedback({ ok: useAi ? 'Você passa a trabalhar com IA.' : 'Você passa a trabalhar sem IA.' });
      status.reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setSaving(false);
    }
  }

  // O que vale na prática: a escolha só tem efeito com a IA ligada e o acesso liberado.
  const note = !data.useAi
    ? 'O Auxílio da IA fica fora das suas traduções; o sistema segue normalmente.'
    : !data.configured || !data.enabled
      ? 'A IA está desligada no momento; sua escolha passa a valer quando ela for ligada.'
      : !data.allowed
        ? 'Seu acesso à IA foi limitado pela liderança; até ser liberado, você trabalha sem IA.'
        : 'Você recebe o Auxílio da IA (glossário, diagramação e dúvidas) nas suas traduções.';

  return (
    <div className="card ai-choice">
      <span className="who">
        <strong>Auxílio da IA</strong>
        <span className="muted small-text">{note}</span>
      </span>
      <Segmented
        label="Trabalhar com ou sem IA"
        value={data.useAi ? 'with' : 'without'}
        options={[
          ['with', 'Com IA'],
          ['without', 'Sem IA'],
        ]}
        onChange={(value) => !saving && void choose(value === 'with')}
      />
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
    </div>
  );
}

type Metric = 'received' | 'approved' | 'firstTime' | 'avgMinutes';
const METRICS: Array<[Metric, string]> = [
  ['received', 'Recebidos'],
  ['approved', 'Concluídos'],
  ['firstTime', 'Acerto de primeira'],
  ['avgMinutes', 'Tempo até concluir'],
];
const SERIES_NAMES: [string, string] = ['Com IA', 'Sem IA'];
const QUICK: Array<[string, string]> = [
  ['30', '30 dias'],
  ['90', '90 dias'],
  ['180', '6 meses'],
];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Valor da métrica num ponto; acerto em % das concluídas e tempo só quando houve conclusão. */
function value(point: AiComparisonPoint, metric: Metric): number | null {
  if (metric === 'firstTime') return point.approved ? percent(point.firstTime, point.approved) : null;
  if (metric === 'avgMinutes') return point.avgMinutes;
  return point[metric];
}
const formatFor = (metric: Metric) =>
  metric === 'firstTime' ? (v: number) => `${v}%` : metric === 'avgMinutes' ? (v: number) => duration(v) : undefined;

/**
 * Protocolos com IA × sem IA (ADR-022), no workspace do Diretor e dos Supervisores: a métrica escolhida, semana a
 * semana, com o total de cada lado e a diferença. Atualiza sozinho a cada minuto.
 */
export function AiComparisonPanel({ me }: { me: Me }) {
  const isDirector = me.user.orgRole === 'director';
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const choices = (teams.data?.items ?? []).filter((team) => isDirector || team.myRole === 'leader');
  const [teamId, setTeamId] = useState('');
  const [quick, setQuick] = useState('90');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [metric, setMetric] = useState<Metric>('received');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((current) => current + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const range =
    period.from && period.to ? period : { from: isoDay(new Date(Date.now() - (Number(quick) - 1) * 86_400_000)), to: isoDay(new Date()) };
  const { data, error } = useLoad(
    () => api<Comparison>('GET', `/dashboards/ai-comparison${queryString({ ...range, teamId: teamId || undefined })}`),
    [range.from, range.to, teamId, tick],
  );

  const format = formatFor(metric);
  const show = (v: number | null) => (v === null ? '—' : format ? format(v) : v.toLocaleString('pt-BR'));
  const totals = data ? ([value(data.withAi, metric), value(data.withoutAi, metric)] as const) : null;
  const label = METRICS.find(([key]) => key === metric)![1];

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `com-ia-x-sem-ia-${data.period.from}-a-${data.period.to}.csv`,
      [
        'Semana',
        'Recebidos com IA',
        'Recebidos sem IA',
        'Concluídos com IA',
        'Concluídos sem IA',
        'Acerto 1ª com IA (%)',
        'Acerto 1ª sem IA (%)',
        'Tempo médio com IA (min)',
        'Tempo médio sem IA (min)',
      ],
      data.weeks.map((week) => [
        week.week,
        week.withAi.received,
        week.withoutAi.received,
        week.withAi.approved,
        week.withoutAi.approved,
        value(week.withAi, 'firstTime'),
        value(week.withoutAi, 'firstTime'),
        week.withAi.avgMinutes,
        week.withoutAi.avgMinutes,
      ]),
    );
  }

  return (
    <ChartCard
      title="Protocolos com IA × sem IA"
      subtitle="Cada protocolo conta pela escolha de quem pediu a tradução quando ela foi criada. Atualiza a cada minuto."
      wide
    >
      <div className="ai-filters">
        <Segmented label="Métrica" value={metric} options={METRICS} onChange={setMetric} />
        <Segmented
          label="Período"
          value={period.from && period.to ? '' : quick}
          options={QUICK}
          onChange={(next) => {
            setQuick(next);
            setPeriod({ from: '', to: '' });
          }}
        />
        <DateRange label="Ou escolha as datas" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        {choices.length > 1 && (
          <label className="inline">
            <span className="muted small-text">Equipe</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{isDirector ? 'Todas as equipes' : 'Minhas equipes'}</option>
              {choices.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="secondary" disabled={!data} onClick={exportCsv}>
          CSV
        </button>
      </div>
      <Feedback error={error} />
      {data && totals && (
        <>
          <div className="ai-compare-tiles">
            {SERIES_NAMES.map((name, index) => {
              const side = index === 0 ? data.withAi : data.withoutAi;
              return (
                <div key={name} className="card stat-tile">
                  <span className="muted small-text">
                    <i style={{ background: SERIES[index] }} />
                    {name} · {label}
                  </span>
                  <strong>{show(totals[index] ?? null)}</strong>
                  <span className="muted small-text">
                    {side.received} recebidos · {side.approved} concluídos · {side.inProgress} em andamento
                  </span>
                </div>
              );
            })}
            <div className="card stat-tile">
              <span className="muted small-text">Diferença (com IA − sem IA)</span>
              <strong>{totals[0] === null || totals[1] === null ? '—' : difference(totals[0], totals[1], metric)}</strong>
              <span className="muted small-text">
                Chamadas à IA no período: {data.aiCalls.ok ?? 0} respondidas · {data.aiCalls.blocked ?? 0} barradas
              </span>
            </div>
          </div>
          <PairedColumns
            items={data.weeks.map((week) => ({
              label: shortDate(week.week),
              values: [value(week.withAi, metric), value(week.withoutAi, metric)],
            }))}
            series={SERIES_NAMES}
            {...(format ? { format } : {})}
          />
        </>
      )}
    </ChartCard>
  );
}

function difference(withAi: number, withoutAi: number, metric: Metric) {
  const delta = withAi - withoutAi;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  if (metric === 'firstTime') return `${sign}${Math.abs(delta)} p.p.`;
  if (metric === 'avgMinutes') return `${sign}${duration(Math.abs(delta))}`;
  return `${sign}${Math.abs(delta).toLocaleString('pt-BR')}`;
}

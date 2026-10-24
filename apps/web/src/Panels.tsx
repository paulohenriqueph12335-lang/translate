import { TranslatorNumberingDashboard } from './TranslatorNumbering';
import { DashboardWidgets } from './DashboardWidgets';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, pairLabel, roleLabel, translationStatusLabel, type Me, type Team, type TranslationStatus } from './api';
import { ChartCard, downloadCsv, duration, INK_BLUE, Meter, OUTCOME_COLORS, percent, RankedBars, SEPIA, StackedShare } from './Charts';
import {
  docsOf,
  Funnel,
  funnelOf,
  KpiTile,
  LiveNow,
  loadInsight,
  PeopleHeatmap,
  periodText,
  shortDate,
  TrendChart,
  usePeriodFilter,
  useStableLoad,
  weeklySeries,
  weeksOf,
  type Insight,
  type PeriodState,
} from './Insights';
import { dateTime, Feedback, normalize, SearchInput, Section, useLoad } from './ui';

const OUTCOMES = ['Acerto de primeira', 'Refeita', 'Concluída com justificativa'];

/** Período atual e, quando a comparação está ligada, o anterior de mesmo tamanho, carregados juntos. */
function useInsightPair(period: PeriodState, teamIds: string[] | null, withOrg: boolean, orgTeamId?: string) {
  const ready = teamIds !== null;
  const key = JSON.stringify([period.range, period.compare, teamIds, withOrg, orgTeamId]);
  return useStableLoad<{ current: Insight; previous: Insight | null } | null>(async () => {
    if (!ready) return null;
    const [current, previous] = await Promise.all([
      loadInsight(period.range, teamIds, withOrg, orgTeamId),
      period.compare ? loadInsight(period.previous, teamIds, withOrg, orgTeamId) : null,
    ]);
    return { current, previous };
  }, key);
}

type TrendMetric = 'approved' | 'received';

/** Tendência semanal com troca de medida; o período anterior entra tracejado, semana a semana. */
function WeeklyTrend({
  period,
  current,
  previous,
  approvedOverride,
}: {
  period: PeriodState;
  current: Insight;
  previous: Insight | null;
  /** Concluídas por semana vindas do painel da organização (sem o limite de documentos do painel de equipe). */
  approvedOverride?: { current: number[]; previous: number[] | null };
}) {
  const [metric, setMetric] = useState<TrendMetric>('approved');
  const now = weeklySeries(docsOf(current), period.range);
  const before = previous ? weeklySeries(docsOf(previous), period.previous) : null;
  const align = (values: number[]) => now.weeks.map((_, index) => values[index] ?? 0);
  const values = metric === 'approved' ? (approvedOverride?.current ?? now.approved) : now.received;
  const old = before ? (metric === 'approved' ? (approvedOverride?.previous ?? before.approved) : before.received) : null;
  const name = metric === 'approved' ? 'Concluídas' : 'Recebidas';
  return (
    <>
      <div className="chart-tools">
        <div className="segmented" role="radiogroup" aria-label="Medida da tendência">
          {(
            [
              ['approved', 'Concluídas'],
              ['received', 'Recebidas'],
            ] as Array<[TrendMetric, string]>
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
      </div>
      <TrendChart
        labels={now.weeks.map(shortDate)}
        series={[
          { name: `${name} · período atual`, color: INK_BLUE, values },
          ...(old ? [{ name: `${name} · período anterior`, color: SEPIA, values: align(old), dashed: true }] : []),
        ]}
      />
    </>
  );
}

/** Concluídas por semana do painel da organização, nas mesmas semanas que a tendência desenha. */
function orgWeeks(byWeek: Array<{ week: string; approved: number }>, weeks: string[]) {
  const map = new Map(byWeek.map((row) => [row.week.slice(0, 10), row.approved]));
  return weeks.map((week) => map.get(week) ?? 0);
}

type SortDir = 1 | -1;

/** Cabeçalho de coluna que ordena a tabela ao clicar. */
function SortHead<K extends string>({
  id,
  sort,
  onSort,
  children,
}: {
  id: K;
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  children: ReactNode;
}) {
  const active = sort.key === id;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-head ${active ? 'on' : ''}`} onClick={() => onSort(id)}>
        {children}
        <span aria-hidden="true">{active ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir: -1 });
  const onSort = (key: K) => setSort((current) => ({ key, dir: current.key === key ? (-current.dir as SortDir) : -1 }));
  return { sort, onSort };
}

const byKey = <T,>(rows: T[], value: (row: T) => number | string | null, dir: SortDir) =>
  [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * dir;
  });

/** Painel do Diretor: período com comparação, fila ao vivo, tendência, funil, idiomas, tipos, equipes e pessoas. */
export function OrganizationPanel({
  onOpenTeam,
  me,
  initialSearch = '',
}: {
  onOpenTeam: (teamId: string) => void;
  me?: Me;
  initialSearch?: string;
}) {
  const { state: period, control } = usePeriodFilter(30);
  const [teamId, setTeamId] = useState('');
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const teamIds = teams.data ? (teamId ? [teamId] : teams.data.items.map((team) => team.id)) : null;
  const { data, error, loading } = useInsightPair(period, teamIds, true, teamId || undefined);
  const org = data?.current.org;
  const prev = data?.previous?.org ?? null;
  const t = org?.totals;
  const p = prev?.totals ?? null;
  const docs = docsOf(data?.current ?? null);
  const [reportSearch, setReportSearch] = useState(initialSearch);
  useEffect(() => setReportSearch(initialSearch), [initialSearch]);
  const reportTokens = normalize(reportSearch).split(/\s+/).filter(Boolean);
  const reportDocuments = docs.filter((doc) =>
    reportTokens.every((token) =>
      normalize(
        `${doc.name} ${doc.protocol ?? ''} ${doc.assignee ?? ''} ${doc.documentType ?? ''} ${doc.number ?? ''} ${translationStatusLabel[doc.status]}`,
      ).includes(token),
    ),
  );
  const teamSort = useSort<'name' | 'received' | 'approved' | 'inProgress' | 'change'>('approved');

  function exportCsv() {
    if (!org) return;
    downloadCsv(
      `painel-organizacao-${org.period.from}-a-${org.period.to}.csv`,
      ['Tipo de documento', 'Concluídas', 'Acerto de primeira', 'Refeitas', 'Com justificativa', 'Acerto (%)'],
      org.byType.map((row) => [row.type, row.total, row.firstTime, row.redone, row.overridden, percent(row.firstTime, row.total)]),
    );
  }

  const teamRows = useMemo(() => {
    if (!org) return [];
    const before = new Map(prev?.byTeam.map((row) => [row.team?.id ?? 'none', row.approved]) ?? []);
    const rows = org.byTeam.map((row) => {
      const old = before.get(row.team?.id ?? 'none') ?? null;
      return { ...row, previous: old, change: old ? Math.round(((row.approved - old) / old) * 100) : null };
    });
    const { key, dir } = teamSort.sort;
    return byKey(rows, (row) => (key === 'name' ? (row.team?.name ?? '') : row[key]), dir);
  }, [org, prev, teamSort.sort]);

  return (
    <div className="analytics-view organization-panel-view">
      <Section title="Painel" subtitle="Tudo o que está acontecendo nas traduções, com base nos dados do período.">
        <div className="filters dash-filters no-print">
          {control}
          <select aria-label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Toda a organização</option>
            {teams.data?.items.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <details className="secondary-actions">
            <summary>Exportar e imprimir</summary>
            <div className="actions">
              <button className="small" onClick={exportCsv} disabled={!org}>
                Exportar CSV
              </button>
              <button className="small" onClick={() => window.print()}>
                Imprimir / PDF
              </button>
            </div>
          </details>
        </div>
        <Feedback error={error ?? teams.error} />
        <div className="filters report-search no-print">
          <SearchInput
            value={reportSearch}
            onChange={setReportSearch}
            placeholder="Pesquisar documentos no relatório por protocolo, arquivo ou pessoa"
          />
        </div>
        {reportSearch.trim() && (
          <div className="card top-gap report-search-results">
            <h3>Documentos encontrados no relatório ({reportDocuments.length})</h3>
            <p className="muted small-text">Documentos do período selecionado, até os 300 mais recentes de cada equipe.</p>
            <div className="table-wrap document-report search-document-report">
              <table>
                <thead>
                  <tr>
                    <th>Protocolo / documento</th>
                    <th>Responsável</th>
                    <th>Situação</th>
                    <th>Concluído em</th>
                    <th>Até primeiro download</th>
                    <th>Sem atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {reportDocuments.map((doc) => (
                    <tr key={doc.id}>
                      <td data-label="Protocolo / documento">
                        {doc.protocol ?? 'Sem protocolo'}
                        <span className="block-line">{doc.name}</span>
                      </td>
                      <td data-label="Responsável">{doc.assignee ?? 'Sem responsável'}</td>
                      <td data-label="Situação">{translationStatusLabel[doc.status]}</td>
                      <td data-label="Concluído em">{doc.approvedAt ? dateTime(doc.approvedAt) : 'Em andamento'}</td>
                      <td data-label="Até primeiro download">
                        {doc.firstDownloadedAt
                          ? duration(doc.minutesUntilFirstDownload)
                          : doc.approvedAt
                            ? `Aguardando há ${duration(doc.readyWithoutDownloadMinutes)}`
                            : '—'}
                      </td>
                      <td data-label="Sem atividade">{duration(doc.idleMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!reportDocuments.length && <p className="empty">Nenhum documento no período e equipe selecionados.</p>}
          </div>
        )}
        {org && t && (
          <div className={`dash-body ${loading ? 'stale' : ''}`} aria-busy={loading}>
            <p className="muted small-text period-line">
              {periodText(period.range)}
              {period.compare && ` · comparado com ${periodText(period.previous)}`}
            </p>
            <div className="stat-row">
              <KpiTile
                label="Traduções concluídas"
                value={t.approved.toLocaleString('pt-BR')}
                current={t.approved}
                previous={p?.approved ?? null}
                compare={period.compare}
              />
              <KpiTile
                label="Recebidas"
                value={t.received.toLocaleString('pt-BR')}
                current={t.received}
                previous={p?.received ?? null}
                compare={period.compare}
                detail={`${t.inProgress} em andamento agora · ${t.failed} falha(s)`}
              />
              <KpiTile
                label="Acerto de primeira"
                value={`${percent(t.firstTime, t.approved)}%`}
                current={percent(t.firstTime, t.approved)}
                previous={p && p.approved ? percent(p.firstTime, p.approved) : null}
                compare={period.compare}
                format={(n) => `${n}%`}
                detail={`${t.redone + t.overridden} refeitas ou justificadas`}
              />
              <KpiTile
                label="Tempo médio até concluir"
                value={duration(t.avgMinutesToConclude)}
                current={t.avgMinutesToConclude}
                previous={p?.avgMinutesToConclude ?? null}
                better="down"
                compare={period.compare}
                format={duration}
                detail="do envio à conclusão"
              />
            </div>
          </div>
        )}
        <LiveNow teamId={teamId || undefined} canReadAudit />
        {org && t && (
          <div className={`dash-body ${loading ? 'stale' : ''}`} aria-busy={loading}>
            <DashboardWidgets userId={me?.user.id} namespace="organization">
              <ChartCard title="Tendência por semana" subtitle="Período atual em verde; o anterior em linha tracejada" wide>
                <WeeklyTrend
                  period={period}
                  current={data!.current}
                  previous={data!.previous}
                  approvedOverride={{
                    current: orgWeeks(org.byWeek, weeksOf(period.range)),
                    previous: prev ? orgWeeks(prev.byWeek, weeksOf(period.previous)) : null,
                  }}
                />
              </ChartCard>
              <ChartCard title="Funil do fluxo" subtitle="Dos documentos recebidos no período, quantos chegaram a cada etapa" wide>
                <Funnel
                  steps={funnelOf(docs, period.range)}
                  previous={data!.previous ? funnelOf(docsOf(data!.previous), period.previous) : null}
                />
              </ChartCard>
              <ChartCard title="Idiomas" subtitle="Traduções concluídas por par de idiomas">
                <RankedBars items={org.byPair.map((row) => ({ label: pairLabel(row.source, row.target), value: row.count }))} />
              </ChartCard>
              <ChartCard title="Tipos de documento" subtitle="Concluídas no período, do mais para o menos frequente">
                <RankedBars items={org.byType.map((row) => ({ label: row.type, value: row.total }))} />
              </ChartCard>
              <ChartCard
                title="Acertos e erros por tipo de documento"
                subtitle="Acerto = concluída sem pedido para refazer e sem justificativa"
                wide
              >
                <StackedShare
                  parts={OUTCOMES}
                  colors={OUTCOME_COLORS}
                  rows={org.byType.map((row) => ({
                    label: row.type,
                    // Uma tradução refeita e justificada conta como refeita.
                    values: [row.firstTime, row.redone, Math.max(0, row.total - row.firstTime - row.redone)],
                  }))}
                />
              </ChartCard>
              <ChartCard title="Equipes" subtitle="Clique no título da coluna para ordenar e no nome para abrir o painel da equipe" wide>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <SortHead id="name" {...teamSort}>
                          Equipe
                        </SortHead>
                        <SortHead id="received" {...teamSort}>
                          Recebidas
                        </SortHead>
                        <SortHead id="approved" {...teamSort}>
                          Concluídas
                        </SortHead>
                        {period.compare && (
                          <SortHead id="change" {...teamSort}>
                            vs. anterior
                          </SortHead>
                        )}
                        <SortHead id="inProgress" {...teamSort}>
                          Em andamento
                        </SortHead>
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map((row) => (
                        <tr key={row.team?.id ?? 'none'}>
                          <td>
                            {row.team ? (
                              <button className="link" onClick={() => onOpenTeam(row.team!.id)}>
                                {row.team.name}
                              </button>
                            ) : (
                              <span className="muted">Aguardando direcionamento</span>
                            )}
                          </td>
                          <td>{row.received}</td>
                          <td>
                            <span className="cell-bar">
                              <i
                                style={{
                                  width: `${(percent(row.approved, Math.max(1, ...teamRows.map((r) => r.approved))) * 0.8).toFixed(0)}px`,
                                }}
                              />
                              {row.approved}
                            </span>
                          </td>
                          {period.compare && (
                            <td className={row.change === null ? 'muted' : row.change >= 0 ? 'delta-cell good' : 'delta-cell bad'}>
                              {row.change === null ? '—' : `${row.change > 0 ? '+' : row.change < 0 ? '−' : ''}${Math.abs(row.change)}%`}
                            </td>
                          )}
                          <td>{row.inProgress}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
              <ChartCard title="Pessoas por semana" subtitle="Quem concluiu quanto em cada semana; troque para ver o tempo de revisão" wide>
                <PeopleHeatmap docs={docs} range={period.range} />
              </ChartCard>
              <ChartCard title={`Numeração de ${org.numbering.year}`} subtitle="Números emitidos e limites (Numeração)" wide>
                <ul className="list compact">
                  <li>
                    <strong>Organização</strong>
                    <Meter used={org.numbering.organization.used} quota={org.numbering.organization.quota} />
                  </li>
                  {org.numbering.teams.map((row) => (
                    <li key={row.team.id}>
                      <span>{row.team.name}</span>
                      <Meter used={row.used} quota={row.quota} />
                    </li>
                  ))}
                </ul>
              </ChartCard>
            </DashboardWidgets>
          </div>
        )}
      </Section>
    </div>
  );
}

const DOC_STATUSES: Array<[string, string]> = [
  ['', 'Todas as situações'],
  ['progress', 'Em andamento'],
  ['approved', 'Concluídas'],
  ['failed', 'Com falha'],
];
const inProgressStatuses: TranslationStatus[] = ['queued', 'processing', 'in_review', 'awaiting_approval'];

/** Painel da equipe (Supervisor e Diretor): ao vivo, tendência, funil, pessoas por semana, tempos e documentos. */
export function TeamPanel({ me, initialTeamId, initialSearch = '' }: { me: Me; initialTeamId?: string | null; initialSearch?: string }) {
  const isDirector = me.user.orgRole === 'director';
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const choices = (teams.data?.items ?? []).filter((team) => isDirector || team.myRole === 'leader');
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const selected = teamId || choices[0]?.id || '';
  const { state: period, control } = usePeriodFilter(30);
  const { data, error, loading } = useInsightPair(period, teams.data ? (selected ? [selected] : []) : null, false);
  const team = data?.current.teams[0];
  const prevTeam = data?.previous?.teams[0] ?? null;
  const t = team?.totals;
  const p = prevTeam?.totals ?? null;
  const docs = docsOf(data?.current ?? null);
  const funnel = funnelOf(docs, period.range);
  const prevFunnel = data?.previous ? funnelOf(docsOf(data.previous), period.previous) : null;
  const received = funnel[0]!.count;
  const prevReceived = prevFunnel?.[0]!.count ?? null;

  const peopleSort = useSort<'name' | 'delivered' | 'inProgress' | 'redone' | 'review' | 'total'>('delivered');
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => setSearch(initialSearch), [initialSearch]);

  const people = useMemo(() => {
    if (!team) return [];
    const { key, dir } = peopleSort.sort;
    const value = (user: (typeof team.users)[number]) =>
      key === 'name' ? user.name : key === 'review' ? user.avgReviewMinutes : key === 'total' ? user.avgTotalMinutes : user[key];
    return byKey(team.users, value, dir);
  }, [team, peopleSort.sort]);

  const documents = (team?.documents ?? []).filter(
    (doc) =>
      (!person || doc.assignee === person) &&
      (!status || (status === 'progress' ? inProgressStatuses.includes(doc.status) : doc.status === status)) &&
      (!search ||
        normalize(search)
          .split(/\s+/)
          .filter(Boolean)
          .every((token) =>
            normalize(
              `${doc.name} ${doc.protocol ?? ''} ${doc.assignee ?? ''} ${translationStatusLabel[doc.status]} ${doc.documentType ?? ''} ${doc.number ?? ''}`,
            ).includes(token),
          )),
  );

  function exportPeople() {
    if (!team) return;
    downloadCsv(
      `equipe-${team.team.name}-pessoas-${team.period.from}-a-${team.period.to}.csv`,
      [
        'Pessoa',
        'Papel',
        'Entregues',
        'Em andamento',
        'Refeitas',
        'Revisão média (min)',
        'Do envio à conclusão (min)',
        'Cota',
        'Números usados',
      ],
      team.users.map((user) => [
        user.name,
        user.role ? roleLabel[user.role] : '',
        user.delivered,
        user.inProgress,
        user.redone,
        user.avgReviewMinutes,
        user.avgTotalMinutes,
        user.quota,
        user.used,
      ]),
    );
  }
  function exportDocuments() {
    if (!team) return;
    downloadCsv(
      `equipe-${team.team.name}-documentos-${team.period.from}-a-${team.period.to}.csv`,
      [
        'Documento',
        'Responsável',
        'Situação',
        'Tipo',
        'Recebido',
        'Concluído',
        'Processamento (min)',
        'Revisão (min)',
        'Conclusão (min)',
        'Total (min)',
        'Refeito',
        'Número',
        'Protocolo',
        'Primeiro download',
        'Espera até primeiro download (min)',
        'Sem atividade (min)',
        'Pronto sem download (min)',
      ],
      documents.map((doc) => [
        doc.name,
        doc.assignee,
        translationStatusLabel[doc.status],
        doc.documentType,
        doc.createdAt,
        doc.approvedAt,
        doc.processingMinutes,
        doc.reviewMinutes,
        doc.conclusionMinutes,
        doc.totalMinutes,
        doc.redoCount,
        doc.number,
        doc.protocol,
        doc.firstDownloadedAt,
        doc.minutesUntilFirstDownload,
        doc.idleMinutes,
        doc.readyWithoutDownloadMinutes,
      ]),
    );
  }

  return (
    <div className="analytics-view team-panel-view">
      <Section title="Painel da equipe" subtitle="Quanto tempo cada pessoa e cada documento levam, e quantos documentos foram entregues.">
        <div className="filters dash-filters no-print">
          {choices.length > 1 && (
            <select
              aria-label="Equipe"
              value={selected}
              onChange={(e) => {
                setTeamId(e.target.value);
                setPerson('');
              }}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          )}
          {control}
          <span className="spacer" />
          <details className="secondary-actions">
            <summary>Exportar e imprimir</summary>
            <div className="actions">
              <button className="small" onClick={exportPeople} disabled={!team}>
                CSV por pessoa
              </button>
              <button className="small" onClick={exportDocuments} disabled={!team}>
                CSV por documento
              </button>
              <button className="small" onClick={() => window.print()}>
                Imprimir / PDF
              </button>
            </div>
          </details>
        </div>
        {!selected && teams.data && <p className="empty">Você não supervisiona nenhuma equipe.</p>}
        <Feedback error={error ?? teams.error} />
        {team && t && (
          <div className={`dash-body ${loading ? 'stale' : ''}`} aria-busy={loading}>
            <h3 className="top-gap">{team.team.name}</h3>
            <p className="muted small-text period-line">
              {periodText(period.range)}
              {period.compare && ` · comparado com ${periodText(period.previous)}`}
            </p>
            <div className="stat-row">
              <KpiTile
                label="Documentos entregues"
                value={t.delivered.toLocaleString('pt-BR')}
                current={t.delivered}
                previous={p?.delivered ?? null}
                compare={period.compare}
                detail="concluídos no período"
              />
              <KpiTile
                label="Recebidos"
                value={received.toLocaleString('pt-BR')}
                current={received}
                previous={prevReceived}
                compare={period.compare}
                detail={`${t.inProgress} em andamento agora`}
              />
              <KpiTile
                label="Acerto de primeira"
                value={`${percent(t.firstTime, t.delivered)}%`}
                current={percent(t.firstTime, t.delivered)}
                previous={p && p.delivered ? percent(p.firstTime, p.delivered) : null}
                compare={period.compare}
                format={(n) => `${n}%`}
              />
              <KpiTile
                label="Tempo médio até concluir"
                value={duration(t.avgMinutesToConclude)}
                current={t.avgMinutesToConclude}
                previous={p?.avgMinutesToConclude ?? null}
                better="down"
                compare={period.compare}
                format={duration}
              />
            </div>
          </div>
        )}
        {selected && <LiveNow teamId={selected} canReadAudit />}
        {team && t && (
          <div className={`dash-body ${loading ? 'stale' : ''}`} aria-busy={loading}>
            <DashboardWidgets userId={me.user.id} namespace="team" revealId={initialSearch ? 'documentos' : undefined}>
              <ChartCard title="Tendência por semana" subtitle="Período atual em verde; o anterior em linha tracejada" wide>
                <WeeklyTrend period={period} current={data!.current} previous={data!.previous} />
              </ChartCard>
              <ChartCard title="Funil do fluxo" subtitle="Dos documentos recebidos no período, quantos chegaram a cada etapa" wide>
                <Funnel steps={funnel} previous={prevFunnel} />
              </ChartCard>
              <ChartCard title="Pessoas por semana" subtitle="Quem concluiu quanto em cada semana; troque para ver o tempo de revisão" wide>
                <PeopleHeatmap docs={docs} range={period.range} />
              </ChartCard>
              <ChartCard title="Entregas por pessoa" subtitle="Traduções concluídas no período">
                <RankedBars
                  items={team.users.filter((user) => user.delivered > 0).map((user) => ({ label: user.name, value: user.delivered }))}
                />
              </ChartCard>
              <ChartCard title="Tempo médio de revisão por pessoa" subtitle="Do rascunho pronto até marcar como pronta, em minutos">
                <RankedBars
                  unit=" min"
                  items={team.users
                    .filter((user) => user.avgReviewMinutes !== null)
                    .map((user) => ({ label: user.name, value: user.avgReviewMinutes! }))
                    .sort((a, b) => b.value - a.value)}
                />
              </ChartCard>
              <ChartCard title="Pessoas" subtitle="Ordene pelas colunas; clique no nome para ver só os documentos da pessoa" wide>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <SortHead id="name" {...peopleSort}>
                          Pessoa
                        </SortHead>
                        <SortHead id="delivered" {...peopleSort}>
                          Entregues
                        </SortHead>
                        <SortHead id="inProgress" {...peopleSort}>
                          Em andamento
                        </SortHead>
                        <SortHead id="redone" {...peopleSort}>
                          Refeitas
                        </SortHead>
                        <SortHead id="review" {...peopleSort}>
                          Revisão média
                        </SortHead>
                        <SortHead id="total" {...peopleSort}>
                          Envio → conclusão
                        </SortHead>
                        <th>Numeração {team.period.to.slice(0, 4)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((user) => (
                        <tr key={user.id} className={person === user.name ? 'current-row' : ''}>
                          <td>
                            <button
                              className="link"
                              aria-pressed={person === user.name}
                              onClick={() => setPerson((current) => (current === user.name ? '' : user.name))}
                            >
                              {user.name}
                            </button>{' '}
                            {user.role && <span className="badge soft">{roleLabel[user.role]}</span>}
                          </td>
                          <td>{user.delivered}</td>
                          <td>{user.inProgress}</td>
                          <td>{user.redone}</td>
                          <td>{duration(user.avgReviewMinutes)}</td>
                          <td>{duration(user.avgTotalMinutes)}</td>
                          <td>
                            <Meter used={user.used} quota={user.quota} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
              <ChartCard title="Documentos" subtitle="Tempo de cada etapa: processamento, revisão e conclusão" wide>
                <div className="filters chart-tools">
                  <input
                    type="search"
                    aria-label="Buscar documento"
                    placeholder="Buscar protocolo, nome, pessoa, tipo ou número"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select aria-label="Responsável" value={person} onChange={(e) => setPerson(e.target.value)}>
                    <option value="">Todas as pessoas</option>
                    {team.users.map((user) => (
                      <option key={user.id} value={user.name}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {DOC_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="muted small-text">
                    {documents.length} de {team.documents.length}
                  </span>
                </div>
                <div className="table-wrap document-report team-document-report">
                  <table>
                    <thead>
                      <tr>
                        <th>Documento</th>
                        <th>Responsável</th>
                        <th>Situação</th>
                        <th>Processamento</th>
                        <th>Revisão</th>
                        <th>Conclusão</th>
                        <th>Total</th>
                        <th>Concluído em</th>
                        <th>Até primeiro download</th>
                        <th>Sem atividade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.id}>
                          <td className="name-cell" data-label="Documento">
                            {doc.name}
                            {doc.protocol && <strong className="block-line small-text">{doc.protocol}</strong>}
                            <span className="muted small-text block-line">
                              {dateTime(doc.createdAt)}
                              {doc.number ? ` · nº ${doc.number}` : ''}
                              {doc.redoCount ? ` · refeito ${doc.redoCount}x` : ''}
                            </span>
                          </td>
                          <td data-label="Responsável">{doc.assignee ?? <span className="muted">sem responsável</span>}</td>
                          <td data-label="Situação">{translationStatusLabel[doc.status]}</td>
                          <td data-label="Processamento">{duration(doc.processingMinutes)}</td>
                          <td data-label="Revisão">{duration(doc.reviewMinutes)}</td>
                          <td data-label="Conclusão">{duration(doc.conclusionMinutes)}</td>
                          <td data-label="Total">{duration(doc.totalMinutes)}</td>
                          <td data-label="Concluído em">{doc.approvedAt ? dateTime(doc.approvedAt) : 'Em andamento'}</td>
                          <td data-label="Até primeiro download">
                            {doc.firstDownloadedAt ? (
                              <>
                                <span>{duration(doc.minutesUntilFirstDownload)}</span>
                                <span className="muted small-text block-line">{dateTime(doc.firstDownloadedAt)}</span>
                              </>
                            ) : doc.approvedAt ? (
                              `Aguardando há ${duration(doc.readyWithoutDownloadMinutes)}`
                            ) : (
                              '—'
                            )}
                          </td>
                          <td
                            data-label="Sem atividade"
                            title={doc.lastActivityAt ? `Última atividade: ${dateTime(doc.lastActivityAt)}` : undefined}
                          >
                            {duration(doc.idleMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {documents.length === 0 && <p className="empty">Nenhum documento com esses filtros.</p>}
              </ChartCard>
            </DashboardWidgets>
          </div>
        )}
        {/* Uso de números e gratuitos de cada tradutor (ADR-014): o controle administrativo do Supervisor. */}
        <h3 className="top-gap">Numeração dos tradutores</h3>
        <TranslatorNumberingDashboard compact />
      </Section>
    </div>
  );
}

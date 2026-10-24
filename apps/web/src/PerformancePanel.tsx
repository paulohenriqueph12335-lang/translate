import { useState } from 'react';
import {
  api,
  modeLabel,
  pairLabel,
  queryString,
  translationStatusLabel,
  type Language,
  type Me,
  type Team,
  type TranslationStatus,
} from './api';
import { ChartCard, duration, INK_BLUE, RankedBars, SEPIA, StackedShare, StatTile, downloadCsv } from './Charts';
import { DashboardWidgets } from './DashboardWidgets';
import { shortDate, TrendChart, usePeriodFilter, useStableLoad } from './Insights';
import { dateTime, Feedback, Section, useLoad } from './ui';
import { LanguagePairPicker } from './LanguagePairPicker';

interface Performance {
  period: { from: string; to: string };
  totals: {
    received: number;
    approved: number;
    firstTime: number;
    reworked: number;
    failed: number;
    inProgress: number;
    inReview: number;
    blocked: number;
    awaitingDownload: number;
    avgMinutes: number | null;
    avgDownloadMinutes: number | null;
    approvedInspections: number;
    rejectedInspections: number;
    firstTimeRate: number | null;
  };
  weeks: Array<{ week: string; received: number; approved: number; reworked: number }>;
  failedStages: Array<{ stage: string; count: number }>;
  failureCauses: Array<{ code: string; count: number }>;
  documents: Array<{
    id: string;
    name: string;
    protocol: string | null;
    status: TranslationStatus;
    sourceLanguage: Language;
    targetLanguage: Language;
    redoCount: number;
    createdAt: string;
    approvedAt: string | null;
    failureCode: string | null;
  }>;
  documentsTruncated: boolean;
}
const stages: Record<string, string> = { correction: 'Correção', translation: 'Tradução', layout: 'Diagramação', review: 'Revisão' };
const causes: Record<string, string> = {
  attempts_exhausted: 'Tentativas automáticas esgotadas',
  processing_error: 'Erro no processamento',
  unsupported_format: 'Formato não suportado',
  empty_document: 'Documento sem texto',
  storage_unavailable: 'Armazenamento indisponível',
};

/** Personal requests are scoped by the server to the signed-in assignee, including all aggregate counts. */
export function PerformancePanel({
  me,
  personal = false,
  onOpenTranslation,
}: {
  me: Me;
  personal?: boolean;
  onOpenTranslation: (id: string) => void;
}) {
  const { state: period, control } = usePeriodFilter(30);
  const [pair, setPair] = useState('');
  const [mode, setMode] = useState('');
  const [teamId, setTeamId] = useState('');
  const teams = useLoad(() => (personal ? Promise.resolve({ items: [] as Team[] }) : api<{ items: Team[] }>('GET', '/teams')), [personal]);
  const endpoint = personal ? 'individual' : 'quality';
  const filters = {
    sourceLanguage: pair ? pair.slice(0, 2) : undefined,
    targetLanguage: pair ? pair.slice(3) : undefined,
    mode,
    teamId: personal ? undefined : teamId,
  };
  const key = JSON.stringify([endpoint, period, filters]);
  const { data, error, loading } = useStableLoad(async () => {
    const [current, previous] = await Promise.all([
      api<Performance>('GET', `/dashboards/${endpoint}${queryString({ ...period.range, ...filters })}`),
      period.compare
        ? api<Performance>('GET', `/dashboards/${endpoint}${queryString({ ...period.previous, ...filters })}`)
        : Promise.resolve(null),
    ]);
    return { current, previous };
  }, key);
  const current = data?.current;
  const t = current?.totals;
  const previous = data?.previous?.totals;
  const title = personal ? 'Meu desenvolvimento' : 'Erros × acertos';
  return (
    <Section
      title={title}
      subtitle={
        personal
          ? 'Sua produção, suas entregas e suas revisões. Os dados incluem somente documentos sob sua responsabilidade.'
          : 'Produtividade, retrabalho, conferências humanas e falhas técnicas da organização.'
      }
    >
      <div className="filters dash-filters no-print">
        {control}
        {!personal && (
          <select aria-label="Equipe da qualidade" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Toda a organização</option>
            {teams.data?.items.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        <LanguagePairPicker label="Idiomas do desenvolvimento" value={pair} onChange={setPair} any="Todos os pares de idiomas" />
        <select aria-label="Modalidade do desenvolvimento" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">Todas as modalidades</option>
          {Object.entries(modeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          disabled={!current || loading}
          onClick={() =>
            current &&
            downloadCsv(
              `${personal ? 'meu-desenvolvimento' : 'qualidade'}-${current.period.from}.csv`,
              ['Indicador', 'Quantidade'],
              Object.entries(current.totals).map(([label, value]) => [label, value]),
            )
          }
        >
          Exportar indicadores CSV
        </button>
      </div>
      <Feedback error={error ?? teams.error} />
      {loading && <p role="status">Atualizando indicadores…</p>}
      {t && current && (
        <div aria-busy={loading}>
          <div className="stat-row">
            <StatTile
              label="Concluídas no período"
              value={String(t.approved)}
              detail={previous ? `${previous.approved} no período anterior` : 'Pela data de conclusão'}
            />
            <StatTile
              label="Acerto de primeira"
              value={t.firstTimeRate === null ? 'Sem conclusões' : `${t.firstTimeRate}%`}
              detail={`${t.firstTime} sem devolução nem exceção de ${t.approved} concluídas`}
            />
            <StatTile label="Concluídas com retrabalho ou exceção" value={String(t.reworked)} detail="Cada documento conta uma única vez" />
            <StatTile
              label="Falhas técnicas no período"
              value={String(t.failed)}
              detail="Documentos ainda com falha, pela última atualização"
            />
            <StatTile
              label="Em andamento agora"
              value={String(t.inProgress)}
              detail={`${t.inReview} em conferência · ${t.blocked} exigem novo formato após três reprovações`}
            />
            <StatTile
              label="Tempo médio para concluir"
              value={duration(t.avgMinutes)}
              detail={`${t.awaitingDownload} concluídas ainda sem download`}
            />
          </div>
          <p className="muted small-text">
            Acerto de primeira é um indicador do fluxo de revisão. As conferências e as falhas técnicas são contadas separadamente. Médias e
            totais usam todos os registros do filtro; a lista abaixo exibe até 100 documentos.
          </p>
          <DashboardWidgets
            userId={me.user.id}
            namespace={personal ? 'personal-development' : 'quality'}
            widgets={[
              {
                id: 'trend',
                title: 'Evolução da produção',
                defaultVisible: true,
                wide: true,
                content: (
                  <ChartCard title="Evolução da produção" subtitle="Conclusões por semana, com comparação de períodos">
                    <TrendChart
                      labels={current.weeks.map((w) => shortDate(w.week))}
                      series={[
                        { name: 'Concluídas', color: INK_BLUE, values: current.weeks.map((w) => w.approved) },
                        ...(data.previous
                          ? [
                              {
                                name: 'Período anterior',
                                color: SEPIA,
                                dashed: true,
                                values: current.weeks.map((_, i) => data.previous?.weeks[i]?.approved ?? 0),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </ChartCard>
                ),
              },
              {
                id: 'outcomes',
                title: 'Acertos e retrabalho',
                defaultVisible: true,
                content: (
                  <ChartCard title="Acertos e retrabalho" subtitle="Categorias exclusivas entre documentos concluídos">
                    <StackedShare
                      parts={['Acerto de primeira', 'Retrabalho ou exceção']}
                      rows={[{ label: 'Concluídas', values: [t.firstTime, t.reworked] }]}
                    />
                  </ChartCard>
                ),
              },
              {
                id: 'reviews',
                title: 'Conferências e fases',
                defaultVisible: !personal,
                content: (
                  <ChartCard
                    title="Conferências humanas"
                    subtitle={`${t.approvedInspections} aprovadas · ${t.rejectedInspections} reprovadas no período; um documento pode ter várias conferências`}
                  >
                    <RankedBars
                      items={current.failedStages.map((item) => ({ label: stages[item.stage] ?? item.stage, value: item.count }))}
                    />
                  </ChartCard>
                ),
              },
              {
                id: 'technical',
                title: 'Causas de falha',
                defaultVisible: !personal,
                content: (
                  <ChartCard title="Causas de falha técnica" subtitle="Falhas atuais atualizadas no período">
                    <RankedBars
                      items={current.failureCauses.map((item) => ({ label: causes[item.code] ?? item.code, value: item.count }))}
                    />
                  </ChartCard>
                ),
              },
              {
                id: 'documents',
                title: personal ? 'Meus documentos' : 'Documentos do período',
                defaultVisible: true,
                wide: true,
                content: (
                  <ChartCard
                    title={personal ? 'Meus documentos' : 'Documentos do período'}
                    subtitle={
                      current.documentsTruncated
                        ? '100 mais recentes. Os indicadores acima incluem os demais.'
                        : `${current.documents.length} documento(s) recebidos ou concluídos no período`
                    }
                  >
                    <div className="table-wrap" role="region" aria-label="Documentos do desenvolvimento" tabIndex={0}>
                      <table>
                        <thead>
                          <tr>
                            <th>Documento / protocolo</th>
                            <th>Idiomas</th>
                            <th>Situação</th>
                            <th>Devoluções</th>
                            <th>Conclusão</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {current.documents.map((doc) => (
                            <tr key={doc.id}>
                              <td>
                                {doc.name}
                                <span className="block-line muted small-text">{doc.protocol ?? 'Sem protocolo'}</span>
                              </td>
                              <td>{pairLabel(doc.sourceLanguage, doc.targetLanguage)}</td>
                              <td>
                                {translationStatusLabel[doc.status]}
                                {doc.failureCode && (
                                  <span className="block-line small-text">{causes[doc.failureCode] ?? doc.failureCode}</span>
                                )}
                              </td>
                              <td>{doc.redoCount}</td>
                              <td>{doc.approvedAt ? dateTime(doc.approvedAt) : 'Em andamento'}</td>
                              <td>
                                <button className="small" onClick={() => onOpenTranslation(doc.id)}>
                                  Abrir
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!current.documents.length && <p className="empty">Nenhum documento neste período e filtros.</p>}
                  </ChartCard>
                ),
              },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

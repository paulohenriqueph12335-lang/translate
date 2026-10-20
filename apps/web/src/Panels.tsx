import { TranslatorNumberingDashboard } from './TranslatorNumbering';
import { useState } from 'react';
import {
  api,
  pairLabel,
  queryString,
  roleLabel,
  translationStatusLabel,
  type Me,
  type OrganizationDashboard,
  type Team,
  type TeamDashboard,
} from './api';
import { ChartCard, Columns, Donut, downloadCsv, duration, Meter, percent, RankedBars, StackedShare, StatTile, TableView } from './Charts';
import { dateTime, DateRange, Feedback, Section, useLoad } from './ui';

const OUTCOMES = ['Acerto de primeira', 'Refeita', 'Concluída com justificativa'];

/** Período padrão dos painéis: últimos 30 dias (a API aplica o mesmo quando vazio). */
function usePeriod() {
  const [period, setPeriod] = useState({ from: '', to: '' });
  return { period, setPeriod, query: { from: period.from || undefined, to: period.to || undefined } };
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Painel do Diretor: traduções, idiomas, tipos de documento, acertos e erros, equipes e numeração. */
export function OrganizationPanel({ onOpenTeam }: { onOpenTeam: (teamId: string) => void }) {
  const { period, setPeriod, query } = usePeriod();
  const [teamId, setTeamId] = useState('');
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const { data, error } = useLoad(
    () => api<OrganizationDashboard>('GET', `/dashboards/organization${queryString({ ...query, teamId })}`),
    [period.from, period.to, teamId],
  );
  const t = data?.totals;
  const errors = t ? t.redone + t.overridden : 0;

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `painel-organizacao-${data.period.from}-a-${data.period.to}.csv`,
      ['Tipo de documento', 'Concluídas', 'Acerto de primeira', 'Refeitas', 'Com justificativa', 'Acerto (%)'],
      data.byType.map((row) => [row.type, row.total, row.firstTime, row.redone, row.overridden, percent(row.firstTime, row.total)]),
    );
  }

  return (
    <Section title="Painel" subtitle="Tudo o que está acontecendo nas traduções, com base nos dados do período.">
      <div className="filters no-print">
        <DateRange label="Período" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        <select aria-label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Toda a organização</option>
          {teams.data?.items.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="small" onClick={exportCsv} disabled={!data}>
          Exportar CSV
        </button>
        <button className="small" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
      </div>
      <Feedback error={error} />
      {data && t && (
        <>
          <p className="muted small-text">
            De {new Date(`${data.period.from}T00:00:00`).toLocaleDateString('pt-BR')} a{' '}
            {new Date(`${data.period.to}T00:00:00`).toLocaleDateString('pt-BR')}
          </p>
          <div className="stat-row">
            <StatTile
              label="Traduções concluídas"
              value={t.approved.toLocaleString('pt-BR')}
              detail={`${t.received} recebidas no período`}
            />
            <StatTile
              label="Acerto de primeira"
              value={`${percent(t.firstTime, t.approved)}%`}
              detail={`${errors} com erro (refeitas ou justificadas)`}
            />
            <StatTile label="Em andamento agora" value={t.inProgress.toLocaleString('pt-BR')} detail={`${t.failed} falha(s) no período`} />
            <StatTile label="Tempo médio até concluir" value={duration(t.avgMinutesToConclude)} detail="do envio à conclusão" />
          </div>
          <div className="chart-grid">
            <ChartCard title="Idiomas" subtitle="Participação nas traduções concluídas">
              <Donut items={data.byPair.map((row) => ({ label: pairLabel(row.source, row.target), value: row.count }))} />
              <TableView head={['Idiomas', 'Concluídas']} rows={data.byPair.map((row) => [pairLabel(row.source, row.target), row.count])} />
            </ChartCard>
            <ChartCard title="Concluídas por semana">
              <Columns items={data.byWeek.map((row) => ({ label: shortDate(row.week), value: row.approved }))} />
            </ChartCard>
            <ChartCard
              title="Tipos de documento mais e menos traduzidos"
              subtitle="Concluídas no período, do mais para o menos frequente"
              wide
            >
              <RankedBars items={data.byType.map((row) => ({ label: row.type, value: row.total }))} />
            </ChartCard>
            <ChartCard
              title="Acertos e erros por tipo de documento"
              subtitle="Acerto = concluída sem pedido para refazer e sem justificativa"
              wide
            >
              <StackedShare
                parts={OUTCOMES}
                rows={data.byType.map((row) => ({
                  label: row.type,
                  // Uma tradução refeita e justificada conta como refeita.
                  values: [row.firstTime, row.redone, Math.max(0, row.total - row.firstTime - row.redone)],
                }))}
              />
            </ChartCard>
            <ChartCard title="Equipes" subtitle="Clique para abrir o painel da equipe" wide>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Equipe</th>
                      <th>Recebidas</th>
                      <th>Concluídas</th>
                      <th>Em andamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byTeam.map((row) => (
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
                        <td>{row.approved}</td>
                        <td>{row.inProgress}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
            <ChartCard title={`Numeração de ${data.numbering.year}`} subtitle="Números emitidos e limites (Numeração)" wide>
              <ul className="list compact">
                <li>
                  <strong>Organização</strong>
                  <Meter used={data.numbering.organization.used} quota={data.numbering.organization.quota} />
                </li>
                {data.numbering.teams.map((row) => (
                  <li key={row.team.id}>
                    <span>{row.team.name}</span>
                    <Meter used={row.used} quota={row.quota} />
                  </li>
                ))}
              </ul>
            </ChartCard>
          </div>
        </>
      )}
    </Section>
  );
}

/** Painel da equipe (Supervisor e Diretor): tempos por pessoa e por documento, entregas e cotas. */
export function TeamPanel({ me, initialTeamId }: { me: Me; initialTeamId?: string | null }) {
  const isDirector = me.user.orgRole === 'director';
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const choices = (teams.data?.items ?? []).filter((team) => isDirector || team.myRole === 'leader');
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const selected = teamId || choices[0]?.id || '';
  const { period, setPeriod, query } = usePeriod();
  const { data, error } = useLoad(
    () => (selected ? api<TeamDashboard>('GET', `/dashboards/team${queryString({ ...query, teamId: selected })}`) : Promise.resolve(null)),
    [selected, period.from, period.to],
  );
  const t = data?.totals;

  function exportPeople() {
    if (!data) return;
    downloadCsv(
      `equipe-${data.team.name}-pessoas-${data.period.from}-a-${data.period.to}.csv`,
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
      data.users.map((user) => [
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
    if (!data) return;
    downloadCsv(
      `equipe-${data.team.name}-documentos-${data.period.from}-a-${data.period.to}.csv`,
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
      ],
      data.documents.map((doc) => [
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
      ]),
    );
  }

  return (
    <Section title="Painel da equipe" subtitle="Quanto tempo cada pessoa e cada documento levam, e quantos documentos foram entregues.">
      <div className="filters no-print">
        {choices.length > 1 && (
          <select aria-label="Equipe" value={selected} onChange={(e) => setTeamId(e.target.value)}>
            {choices.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        <DateRange label="Período" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        <span className="spacer" />
        <button className="small" onClick={exportPeople} disabled={!data}>
          CSV por pessoa
        </button>
        <button className="small" onClick={exportDocuments} disabled={!data}>
          CSV por documento
        </button>
        <button className="small" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
      </div>
      {!selected && teams.data && <p className="empty">Você não supervisiona nenhuma equipe.</p>}
      <Feedback error={error} />
      {data && t && (
        <>
          <h3 className="top-gap">{data.team.name}</h3>
          <div className="stat-row">
            <StatTile label="Documentos entregues" value={t.delivered.toLocaleString('pt-BR')} detail="concluídos no período" />
            <StatTile label="Em andamento agora" value={t.inProgress.toLocaleString('pt-BR')} />
            <StatTile label="Acerto de primeira" value={`${percent(t.firstTime, t.delivered)}%`} />
            <StatTile label="Tempo médio até concluir" value={duration(t.avgMinutesToConclude)} />
          </div>
          <div className="chart-grid">
            <ChartCard title="Entregas por pessoa" subtitle="Traduções concluídas no período">
              <RankedBars
                items={data.users.filter((user) => user.delivered > 0).map((user) => ({ label: user.name, value: user.delivered }))}
              />
            </ChartCard>
            <ChartCard title="Tempo médio de revisão por pessoa" subtitle="Do rascunho pronto até marcar como pronta, em minutos">
              <RankedBars
                unit=" min"
                items={data.users
                  .filter((user) => user.avgReviewMinutes !== null)
                  .map((user) => ({ label: user.name, value: user.avgReviewMinutes! }))
                  .sort((a, b) => b.value - a.value)}
              />
            </ChartCard>
            <ChartCard title="Pessoas" wide>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th>Entregues</th>
                      <th>Em andamento</th>
                      <th>Refeitas</th>
                      <th>Revisão média</th>
                      <th>Envio → conclusão</th>
                      <th>Numeração {data.period.to.slice(0, 4)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          {user.name} {user.role && <span className="badge soft">{roleLabel[user.role]}</span>}
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
              <div className="table-wrap">
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="name-cell">
                          {doc.name}
                          <span className="muted small-text block-line">
                            {dateTime(doc.createdAt)}
                            {doc.number ? ` · nº ${doc.number}` : ''}
                            {doc.redoCount ? ` · refeito ${doc.redoCount}x` : ''}
                          </span>
                        </td>
                        <td>{doc.assignee ?? <span className="muted">sem responsável</span>}</td>
                        <td>{translationStatusLabel[doc.status]}</td>
                        <td>{duration(doc.processingMinutes)}</td>
                        <td>{duration(doc.reviewMinutes)}</td>
                        <td>{duration(doc.conclusionMinutes)}</td>
                        <td>{duration(doc.totalMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.documents.length === 0 && <p className="empty">Nenhum documento no período.</p>}
            </ChartCard>
          </div>
        </>
      )}
      {/* Uso de números e gratuitos de cada tradutor (ADR-014): o controle administrativo do Supervisor. */}
      <h3 className="top-gap">Numeração dos tradutores</h3>
      <TranslatorNumberingDashboard compact />
    </Section>
  );
}

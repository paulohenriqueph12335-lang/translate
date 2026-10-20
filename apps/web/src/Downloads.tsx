import { useState } from 'react';
import {
  api,
  formatBytes,
  pairLabel,
  queryString,
  type DocumentSearchItem,
  type Me,
  type Team,
  type TranslationFacets,
  type TranslationSummary,
  LANGUAGE_PAIRS,
} from './api';
import { StatusBadge } from './Translations';
import {
  dateTime,
  DateRange,
  Feedback,
  PagedFooter,
  SearchInput,
  Section,
  Segmented,
  TagList,
  useDebounced,
  useLoad,
  usePaged,
} from './ui';

type View = 'translations' | 'originals';

/**
 * Área de downloads (ADR-010): traduções concluídas e documentos enviados, cada original ligado às traduções
 * geradas a partir dele, com filtros por equipe, tipo, etiqueta, idioma, pessoa e período.
 */
export function Downloads({ me, onOpenTranslation }: { me: Me; onOpenTranslation: (id: string) => void }) {
  const [view, setView] = useState<View>('translations');
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const facets = useLoad(() => api<TranslationFacets>('GET', '/translation-facets'), []);
  const showTeams = me.user.orgRole === 'director' || (teams.data?.items.length ?? 0) > 1;

  return (
    <Section title="Downloads" subtitle="Traduções concluídas e documentos enviados, sempre ligados entre si.">
      <Segmented
        label="O que baixar"
        value={view}
        options={[
          ['translations', 'Traduções concluídas'],
          ['originals', 'Documentos enviados'],
        ]}
        onChange={setView}
      />
      {view === 'translations' ? (
        <ConcludedTranslations teams={showTeams ? (teams.data?.items ?? []) : []} facets={facets.data} onOpen={onOpenTranslation} />
      ) : (
        <Originals teams={showTeams ? (teams.data?.items ?? []) : []} tags={facets.data?.tags ?? []} onOpen={onOpenTranslation} />
      )}
    </Section>
  );
}

function TeamSelect({ teams, value, onChange }: { teams: Team[]; value: string; onChange: (value: string) => void }) {
  if (!teams.length) return null;
  return (
    <select aria-label="Equipe" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todas as equipes</option>
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </select>
  );
}

function ConcludedTranslations({
  teams,
  facets,
  onOpen,
}: {
  teams: Team[];
  facets: TranslationFacets | null;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [teamId, setTeamId] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [tag, setTag] = useState('');
  const [pair, setPair] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const list = usePaged<TranslationSummary>(
    `/translations${queryString({
      limit: 30,
      status: 'approved',
      q,
      teamId,
      documentType,
      tag,
      approvedBy,
      sourceLanguage: pair ? pair.slice(0, 2) : undefined,
      targetLanguage: pair ? pair.slice(3) : undefined,
      approvedFrom: period.from,
      approvedTo: period.to,
    })}`,
  );
  const filtered = !!(q || teamId || documentType || tag || pair || approvedBy || period.from || period.to);

  return (
    <>
      <div className="filters top-gap">
        <SearchInput value={search} onChange={setSearch} placeholder="Arquivo, lote, tipo ou nº (0001/2026)" />
        <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
        <select aria-label="Tipo de documento" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {facets?.documentTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Todas as etiquetas</option>
          {facets?.tags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select aria-label="Idiomas" value={pair} onChange={(e) => setPair(e.target.value)}>
          <option value="">Todos os idiomas</option>
          {LANGUAGE_PAIRS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select aria-label="Concluída por" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}>
          <option value="">Concluída por qualquer pessoa</option>
          {facets?.approvers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <DateRange label="Concluídas" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setTeamId('');
              setDocumentType('');
              setTag('');
              setPair('');
              setApprovedBy('');
              setPeriod({ from: '', to: '' });
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Documento</th>
              <th>Tipo</th>
              <th>Equipe</th>
              <th>Concluída</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td className="nowrap">{item.number?.split(' – ')[0]}</td>
                <td className="name-cell">
                  <button className="link" onClick={() => onOpen(item.id)} title="Abrir a tradução">
                    {item.document.name}
                  </button>
                  <TagList tags={item.document.tags} onPick={setTag} />
                  <span className="muted small-text">
                    {pairLabel(item.sourceLanguage, item.targetLanguage)} · lote {item.batch.name ?? 'sem nome'} · enviado por{' '}
                    {item.uploadedBy}
                  </span>
                </td>
                <td>{item.documentType ?? '—'}</td>
                <td>{item.team?.name ?? '—'}</td>
                <td className="nowrap">
                  {item.approvedAt ? dateTime(item.approvedAt) : '—'}
                  <span className="muted small-text block-line">{item.approvedBy}</span>
                </td>
                <td className="actions">
                  <a className="button small primary" href={`/api/v1/translations/${item.id}/final`}>
                    Tradução
                  </a>
                  <a className="button small" href={`/api/v1/documents/${item.document.id}/original`}>
                    Original
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PagedFooter
        hasMore={list.hasMore}
        loading={list.loading}
        onMore={list.more}
        empty={list.items.length === 0}
        emptyText={filtered ? 'Nenhuma tradução concluída corresponde aos filtros.' : 'Nenhuma tradução concluída ainda.'}
      />
    </>
  );
}

function Originals({ teams, tags, onOpen }: { teams: Team[]; tags: string[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [teamId, setTeamId] = useState('');
  const [tag, setTag] = useState('');
  const [format, setFormat] = useState('');
  const [translation, setTranslation] = useState('');
  const [mine, setMine] = useState(false);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const list = usePaged<DocumentSearchItem>(
    `/documents${queryString({
      limit: 30,
      status: 'stored',
      q,
      teamId: teamId === '__none' ? undefined : teamId,
      unassigned: teamId === '__none',
      tag: tag === '__none' ? undefined : tag,
      untagged: tag === '__none',
      format,
      translation,
      mine,
      from: period.from,
      to: period.to,
    })}`,
  );
  const filtered = !!(q || teamId || tag || format || translation || mine || period.from || period.to);

  return (
    <>
      <div className="filters top-gap">
        <SearchInput value={search} onChange={setSearch} placeholder="Arquivo, lote, pessoa, tipo ou nº" />
        <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
        <select aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Todas as etiquetas</option>
          <option value="__none">Sem etiqueta</option>
          {tags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select aria-label="Formato" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">Todos os formatos</option>
          {['pdf', 'docx', 'pptx', 'jpeg', 'png'].map((value) => (
            <option key={value} value={value}>
              {value.toUpperCase()}
            </option>
          ))}
        </select>
        <select aria-label="Situação da tradução" value={translation} onChange={(e) => setTranslation(e.target.value)}>
          <option value="">Qualquer situação</option>
          <option value="approved">Com tradução concluída</option>
          <option value="active">Tradução em andamento</option>
          <option value="failed">Com falha</option>
          <option value="none">Sem tradução</option>
        </select>
        <DateRange label="Enviados" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Só os que eu enviei
        </label>
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setTeamId('');
              setTag('');
              setFormat('');
              setTranslation('');
              setMine(false);
              setPeriod({ from: '', to: '' });
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <Feedback error={list.error} />
      <ul className="list">
        {list.items.map((doc) => (
          <li key={doc.id}>
            <div>
              <strong>{doc.name}</strong>
              <span className="muted">
                {doc.format?.toUpperCase()} · {formatBytes(doc.size)} · {doc.team?.name ?? 'Sem equipe'} · lote{' '}
                {doc.batch.name ?? 'sem nome'} · enviado por {doc.uploadedBy.displayName}
                {doc.storedAt ? ` em ${dateTime(doc.storedAt)}` : ''}
              </span>
              <TagList tags={doc.tags} onPick={setTag} />
              {doc.translations.length > 0 && (
                <span className="linked">
                  Gerados:{' '}
                  {doc.translations.map((item) => (
                    <span key={item.id} className="linked-item">
                      <button className="link" onClick={() => onOpen(item.id)}>
                        {pairLabel(item.sourceLanguage, item.targetLanguage)}
                        {item.number ? ` nº ${item.number}` : ''}
                      </button>{' '}
                      <StatusBadge status={item.status} />
                      {item.status === 'approved' && (
                        <a className="button small" href={`/api/v1/translations/${item.id}/final`}>
                          Baixar
                        </a>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <a className="button small" href={`/api/v1/documents/${doc.id}/original`}>
              Original
            </a>
          </li>
        ))}
      </ul>
      <PagedFooter
        hasMore={list.hasMore}
        loading={list.loading}
        onMore={list.more}
        empty={list.items.length === 0}
        emptyText={filtered ? 'Nenhum documento corresponde aos filtros.' : 'Nenhum documento armazenado ainda.'}
      />
    </>
  );
}

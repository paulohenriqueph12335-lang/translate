import { useEffect, useState } from 'react';
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
} from './api';
import { StatusBadge } from './Translations';
import { ArchiveDownloadButtons } from './Flow';
import { LanguagePairPicker } from './LanguagePairPicker';
import { DeliveryMenu, SaveDownloadButton } from './DeliveryActions';
import { dateTime, DateRange, Feedback, PagedFooter, SearchInput, Section, Segmented, useDebounced, useLoad, usePaged } from './ui';

type View = 'translations' | 'originals';

/**
 * Área de downloads (ADR-010): traduções concluídas e documentos enviados, cada original ligado às traduções
 * geradas a partir dele, com filtros por equipe, tipo, idioma, pessoa e período.
 */
export function Downloads({ me, onOpenTranslation }: { me: Me; onOpenTranslation: (id: string) => void }) {
  const [view, setView] = useState<View>('translations');
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const facets = useLoad(() => api<TranslationFacets>('GET', '/translation-facets'), []);
  const showTeams = me.user.orgRole === 'director' || (teams.data?.items.length ?? 0) > 1;

  return (
    <Section title="Downloads" subtitle="Traduções concluídas e documentos enviados, sempre ligados entre si.">
      <div className="doc-domain doc-downloads">
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
          <Originals teams={showTeams ? (teams.data?.items ?? []) : []} onOpen={onOpenTranslation} />
        )}
      </div>
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
  const [pair, setPair] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [q, teamId, documentType, pair, approvedBy, period.from, period.to]);
  const list = usePaged<TranslationSummary>(
    `/translations${queryString({
      limit: 30,
      status: 'approved',
      q,
      teamId,
      documentType,
      approvedBy,
      sourceLanguage: pair ? pair.slice(0, 2) : undefined,
      targetLanguage: pair ? pair.slice(3) : undefined,
      approvedFrom: period.from,
      approvedTo: period.to,
    })}`,
  );
  const filtered = !!(q || teamId || documentType || pair || approvedBy || period.from || period.to);

  return (
    <>
      <div className="filters top-gap doc-filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Protocolo, arquivo, lote, tipo ou nº (0001/2026)" />
        <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
        <select aria-label="Tipo de documento" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {facets?.documentTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <LanguagePairPicker label="Idiomas" value={pair} onChange={setPair} any="Todos os idiomas" />
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
      <div className="card top-gap doc-module doc-archive-selection">
        <div className="actions">
          <label className="check">
            <input
              type="checkbox"
              checked={!!list.items.length && list.items.every((item) => selected.has(item.id))}
              onChange={(event) =>
                setSelected((current) => {
                  const next = new Set(current);
                  for (const item of list.items) {
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                  }
                  return next;
                })
              }
            />
            Selecionar resultados carregados
          </label>
          <span className="muted">{selected.size} selecionado(s)</span>
          {selected.size > 0 && (
            <button className="link" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
          )}
        </div>
        <ArchiveDownloadButtons heading translationIds={[...selected]} disabled={selected.size > 100} />
        {selected.size > 100 && <p className="warn-text">Selecione no máximo 100 documentos por ZIP.</p>}
      </div>
      <ul className="list doc-cards doc-download-cards">
        {list.items.map((item) => (
          <li key={item.id} className="doc-download-card">
            <label className="doc-card-select">
              <span className="sr-only">Selecionar {item.document.name}</span>
              <input
                aria-label={`Selecionar ${item.document.name}`}
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  })
                }
              />
            </label>
            <div className="doc-card-content">
              <div className="doc-card-heading">
                <button className="link" onClick={() => onOpen(item.id)} title="Abrir a tradução">
                  {item.document.name}
                </button>
                {item.number && <span className="badge soft">Nº {item.number.split(' – ')[0]}</span>}
              </div>
              <p className="muted small-text">
                {pairLabel(item.sourceLanguage, item.targetLanguage)} · {item.batch.protocol ? `protocolo ${item.batch.protocol} · ` : ''}
                lote {item.batch.name ?? 'sem nome'} · enviado por {item.uploadedBy}
              </p>
              <dl className="doc-card-metadata">
                <div>
                  <dt>Tipo</dt>
                  <dd>{item.documentType ?? '—'}</dd>
                </div>
                <div>
                  <dt>Equipe</dt>
                  <dd>{item.team?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Concluída</dt>
                  <dd>
                    {item.approvedAt ? dateTime(item.approvedAt) : '—'}
                    <span className="muted small-text block-line">{item.approvedBy}</span>
                  </dd>
                </div>
              </dl>
            </div>
            <div className="actions doc-card-actions">
              <DeliveryMenu
                translationId={item.id}
                version={item.updatedAt}
                batchId={item.batch.id}
                original={{ id: item.document.id, name: item.document.name }}
              />
            </div>
          </li>
        ))}
      </ul>
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

function Originals({ teams, onOpen }: { teams: Team[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [teamId, setTeamId] = useState('');
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
      format,
      translation,
      mine,
      from: period.from,
      to: period.to,
    })}`,
  );
  const filtered = !!(q || teamId || format || translation || mine || period.from || period.to);

  return (
    <>
      <div className="filters top-gap doc-filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Protocolo, arquivo, lote, pessoa, tipo ou nº" />
        <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
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
      <ul className="list doc-cards doc-original-cards">
        {list.items.map((doc) => (
          <li key={doc.id}>
            <div className="doc-card-content">
              <strong>{doc.name}</strong>
              <span className="muted">
                {doc.format?.toUpperCase()} · {formatBytes(doc.size)} · {doc.team?.name ?? 'Sem equipe'} · lote{' '}
                {doc.batch.name ?? 'sem nome'}
                {doc.batch.protocol ? ` · protocolo ${doc.batch.protocol}` : ''} · enviado por {doc.uploadedBy.displayName}
                {doc.storedAt ? ` em ${dateTime(doc.storedAt)}` : ''}
              </span>
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
                      {item.status === 'approved' && <DeliveryMenu translationId={item.id} original={{ id: doc.id, name: doc.name }} />}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <SaveDownloadButton
              url={`/api/v1/documents/${doc.id}/original`}
              name={doc.name}
              mimeType={
                doc.format === 'pdf'
                  ? 'application/pdf'
                  : doc.format === 'docx'
                    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    : 'application/octet-stream'
              }
              label="Salvar original"
            />
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

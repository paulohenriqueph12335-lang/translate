import { useEffect, useId, useState } from 'react';
import { api, auditActionLabel, queryString, type Me } from './api';
import { Feedback, SearchInput } from './ui';

export type SearchGroup = 'documents' | 'translations' | 'protocols' | 'audit' | 'reports' | 'teams';
export interface SmartSearchResult {
  id: string;
  type: SearchGroup;
  title: string;
  snippet: string;
  url: string;
  score: number;
  teamId: string | null;
  translationId?: string;
  documentId?: string;
  batchId?: string;
}
export interface DocumentsSearchTarget {
  q?: string;
  batchId?: string;
}
interface SearchResponse {
  query: string;
  tokens: string[];
  total: number;
  groups: Record<SearchGroup, SmartSearchResult[]>;
}
const names: Record<SearchGroup, string> = {
  protocols: 'Protocolos e remessas',
  documents: 'Documentos',
  translations: 'Traduções e fases',
  audit: 'Auditoria e erros',
  reports: 'Relatórios',
  teams: 'Equipes',
};
const patternActions: Record<string, string> = {
  'pattern.trial_generated': 'Word do ensaio gerado',
  'pattern.trial_approved': 'Revisão do ensaio aprovada',
  'pattern.trial_rejected': 'Revisão do ensaio reprovada',
  'pattern.review_blocked': 'Ensaio bloqueado após três reprovações',
  'pattern.format_registered': 'Nova formatação do ensaio registrada',
};
const displayTitle = (item: SmartSearchResult) =>
  item.type === 'audit'
    ? (auditActionLabel[item.title] ?? patternActions[item.title] ?? 'Atualização registrada na auditoria')
    : item.title;

export function SmartSearch({
  me,
  onOpenTranslation,
  onOpenAudit,
  onOpenDocuments,
  onOpenTeam,
  onOpenReports,
}: {
  me: Me;
  onOpenTranslation?: (id: string) => void;
  onOpenAudit?: (q: string) => void;
  onOpenDocuments?: (target: DocumentsSearchTarget) => void;
  onOpenTeam?: (id: string) => void;
  onOpenReports?: (q: string) => void;
}) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const label = useId();
  const allowed = me.user.orgRole === 'director' || me.memberships.some((m) => m.role === 'leader');
  useEffect(() => {
    if (!allowed || q.trim().length < 2) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api<SearchResponse>('GET', `/search${queryString({ q: q.trim(), limit: 5 })}`)
        .then((result) => {
          if (active) {
            setData(result);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (active) setError(caught instanceof Error ? caught.message : 'Não foi possível pesquisar.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, allowed]);
  if (!allowed) return null;
  const open = (item: SmartSearchResult) => {
    if (item.type === 'audit') {
      onOpenAudit?.(item.id);
      return;
    }
    if (item.type === 'teams' && item.teamId) {
      onOpenTeam?.(item.teamId);
      return;
    }
    if (item.type === 'reports') {
      onOpenReports?.(item.title.replace(/^Relatório\s*·\s*/, ''));
      return;
    }
    if (item.type === 'protocols' || item.type === 'documents') {
      onOpenDocuments?.(item.batchId ? { batchId: item.batchId } : { q: item.title });
      return;
    }
    if (item.translationId) onOpenTranslation?.(item.translationId);
  };
  const canOpen = (item: SmartSearchResult) =>
    item.type === 'audit'
      ? !!onOpenAudit
      : item.type === 'teams'
        ? !!onOpenTeam
        : item.type === 'reports'
          ? !!onOpenReports
          : item.type === 'documents' || item.type === 'protocols'
            ? !!onOpenDocuments
            : !!onOpenTranslation;
  return (
    <section className="smart-search card no-print" aria-labelledby={label}>
      <h3 id={label}>Pesquisa inteligente</h3>
      <p className="muted small-text">
        Encontre protocolos, arquivos, pessoas, equipes, fases, erros e registros. Combine palavras; acentos e maiúsculas não alteram a
        busca.
      </p>
      <SearchInput value={q} onChange={setQ} placeholder="Ex.: ABC-10003, contrato Maria, francês erro" />
      <div role="status" aria-live="polite" className="muted small-text">
        {loading
          ? 'Pesquisando…'
          : data
            ? `${data.total} resultado(s) encontrado(s). Até 5 por categoria.`
            : q.trim().length === 1
              ? 'Digite pelo menos 2 caracteres.'
              : ''}
      </div>
      <Feedback error={error} />
      {data && (
        <div className="smart-search-groups">
          {(Object.keys(names) as SearchGroup[]).map((group) =>
            data.groups[group]?.length ? (
              <section className="smart-search-group" key={group}>
                <h4>{names[group]}</h4>
                <ul className="list compact">
                  {data.groups[group].map((item) => (
                    <li key={item.id}>
                      <div>
                        {canOpen(item) ? (
                          <button type="button" className="link" onClick={() => open(item)}>
                            {displayTitle(item)}
                          </button>
                        ) : (
                          <strong>{displayTitle(item)}</strong>
                        )}
                        <span className="block-line muted small-text">{item.snippet}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          {!data.total && <p className="empty">Nenhum resultado no seu escopo de acesso. Tente menos palavras ou outro protocolo.</p>}
        </div>
      )}
    </section>
  );
}

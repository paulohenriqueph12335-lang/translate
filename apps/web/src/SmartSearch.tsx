import { useEffect, useState } from 'react';
import { api, auditActionLabel, queryString } from './api';

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
export const searchGroupNames: Record<SearchGroup, string> = {
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
export const displayTitle = (item: SmartSearchResult) =>
  item.type === 'audit'
    ? (auditActionLabel[item.title] ?? patternActions[item.title] ?? 'Atualização registrada na auditoria')
    : item.title;

/**
 * Pesquisa inteligente (protocolos, documentos, fases, auditoria, relatórios e equipes), para quem lidera.
 * A pesquisa global (Ctrl+K) usa este gancho; quem não lidera pesquisa só as próprias traduções.
 */
export function useSmartSearch(q: string, allowed: boolean) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  return { data, error, loading };
}

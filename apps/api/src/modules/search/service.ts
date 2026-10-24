import { canReadTeamAudit, isDirector, ledTeams } from '../access/policy.js';
import { AppError, forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { likePattern } from '../pagination.js';
import { searchTokens, severitySql } from '../audit/service.js';

export type SearchGroup = 'documents' | 'translations' | 'protocols' | 'audit' | 'reports' | 'teams';
export interface SearchResult {
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
interface SearchRow {
  id: string;
  type: SearchGroup;
  title: string;
  snippet: string;
  url: string;
  score: number;
  team_id: string | null;
  translation_id: string | null;
  document_id: string | null;
  batch_id: string | null;
  total: number;
}

const statusText = `CASE j.status WHEN 'queued' THEN 'fila aguardando pendente'
  WHEN 'processing' THEN 'processamento processando em andamento'
  WHEN 'in_review' THEN 'revisão revisao traduzido'
  WHEN 'awaiting_approval' THEN 'aprovação aprovacao aguardando revisão'
  WHEN 'approved' THEN 'concluído concluido aprovado pronto download relatório relatorio'
  WHEN 'failed' THEN 'erro falha falhou emergente' WHEN 'cancelled' THEN 'cancelado' END`;
const languageText = (column: string) => `CASE ${column} WHEN 'pt' THEN 'português portugues portuguese por pt'
  WHEN 'en' THEN 'inglês ingles english eng en' WHEN 'fr' THEN 'francês frances french francais fra fran fr'
  WHEN 'es' THEN 'espanhol espanhol spanish esp spa es' WHEN 'it' THEN 'italiano italian ita it' END`;
const languageName = (column: string) =>
  `CASE ${column} WHEN 'pt' THEN 'Português' WHEN 'en' THEN 'Inglês' WHEN 'fr' THEN 'Francês' WHEN 'es' THEN 'Espanhol' WHEN 'it' THEN 'Italiano' END`;
const translationState = `CASE j.status WHEN 'queued' THEN 'Na fila' WHEN 'processing' THEN 'Processando' WHEN 'in_review' THEN 'Em revisão' WHEN 'awaiting_approval' THEN 'Aguardando aprovação' WHEN 'approved' THEN 'Concluída' WHEN 'failed' THEN 'Falha na tradução' WHEN 'cancelled' THEN 'Cancelada' END`;
const documentState = `CASE d.status WHEN 'awaiting_upload' THEN 'Aguardando envio' WHEN 'uploading' THEN 'Enviando' WHEN 'stored' THEN 'Arquivo recebido' WHEN 'rejected' THEN 'Arquivo recusado' WHEN 'upload_failed' THEN 'Falha no envio' WHEN 'cancelled' THEN 'Cancelado' END`;

/** Token search with deterministic relevance; authorization is enforced in every source query. */
export function createSearchService({ pool }: ServiceDeps) {
  async function search(ctx: AuthenticatedContext, input: { q: string; limit?: number }) {
    if (!canReadTeamAudit(ctx.actor)) throw forbidden();
    const q = input.q.trim();
    if (q.length > 200) throw new AppError(400, 'VALIDATION_FAILED', 'A busca deve ter no máximo 200 caracteres');
    const tokens = searchTokens(q);
    const groups: Record<SearchGroup, SearchResult[]> = {
      documents: [],
      translations: [],
      protocols: [],
      audit: [],
      reports: [],
      teams: [],
    };
    if (!tokens.length) return { query: q, tokens, total: 0, groups };
    const params: unknown[] = [
      isDirector(ctx.actor) ? null : ledTeams(ctx.actor),
      tokens.map(likePattern),
      likePattern(tokens.join(' ')),
      Math.min(25, Math.max(1, input.limit ?? 8)),
    ];
    const base = `FROM documents d JOIN batches b ON b.id=d.batch_id LEFT JOIN teams t ON t.id=b.team_id
      LEFT JOIN users owner ON owner.id=b.owner_id LEFT JOIN translation_jobs j ON j.document_id=d.id
      LEFT JOIN users person ON person.id=j.assignee_id
      WHERE ($1::uuid[] IS NULL OR b.team_id=ANY($1::uuid[]))`;
    const documentText = `concat_ws(' ',d.display_name,b.protocol,b.name,b.no_protocol_reason,t.name,owner.display_name,person.display_name,
      d.error_code,j.failure_code,j.document_type,j.document_category,
      CASE j.document_category
        WHEN 'birth_certificate' THEN 'certidão nascimento'
        WHEN 'marriage_certificate' THEN 'certidão casamento'
        WHEN 'death_certificate' THEN 'certidão óbito'
        WHEN 'identity' THEN 'identidade CIN RG'
        WHEN 'driver_license' THEN 'carteira motorista habilitação CNH'
        WHEN 'school_record' THEN 'histórico escolar acadêmico'
        WHEN 'diploma' THEN 'diploma'
        WHEN 'apostille' THEN 'apostila'
        WHEN 'professional_certificate' THEN 'certidão conselho profissional'
        WHEN 'contract' THEN 'contrato'
        WHEN 'invoice' THEN 'fatura extrato'
        ELSE 'documento geral' END,
      j.number_label,j.source_title,j.source_language,j.target_language,j.status,${statusText},
      ${languageText('j.source_language')},${languageText('j.target_language')},j.review_comment,j.failed_stages::text,
      CASE WHEN 'correction'=ANY(j.failed_stages) THEN 'correção correcao' END,
      CASE WHEN 'translation'=ANY(j.failed_stages) THEN 'tradução traducao' END,
      CASE WHEN 'layout'=ANY(j.failed_stages) THEN 'formatação formatacao diagramação diagramacao' END,
      CASE WHEN 'review'=ANY(j.failed_stages) THEN 'revisão revisao' END)`;
    const auditTargetText = `concat_ws(' ',
      (SELECT concat_ws(' ',d.display_name,b.protocol,j.source_language,j.target_language,${languageName('j.source_language')},${languageName('j.target_language')}) FROM translation_jobs j JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id WHERE a.target_type='translation' AND j.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id),
      (SELECT concat_ws(' ',d.display_name,b.protocol) FROM documents d JOIN batches b ON b.id=d.batch_id WHERE a.target_type='document' AND d.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id),
      (SELECT concat_ws(' ',b.name,b.protocol) FROM batches b WHERE a.target_type='batch' AND b.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id))`;
    const auditText = `concat_ws(' ',a.action,u.display_name,t.name,a.metadata::text,a.target_id,a.correlation_id,${auditTargetText},
      CASE WHEN a.action='translation.languages_changed' THEN 'idioma idiomas corrigidos alterados mudança'
           WHEN a.action='batch.created' THEN 'remessa lote criado protocolo'
           WHEN a.action LIKE 'pattern.%' THEN 'ensaio formato formatação revisão'
           WHEN a.action ~ '(failed|failure|error)' THEN 'erro falha'
           WHEN a.action ~ '(returned|rejected)' THEN 'reprovado reprovação refazer' END)`;
    const match = (text: string) => `NOT EXISTS (SELECT 1 FROM unnest($2::text[]) token WHERE unaccent(${text}) NOT ILIKE unaccent(token))`;
    const relevance = (title: string, text: string) => `(CASE WHEN unaccent(${title}) ILIKE unaccent($3::text) THEN 100 ELSE 0 END
      + (SELECT count(*)::int FROM unnest($2::text[]) token WHERE unaccent(${title}) ILIKE unaccent(token))*10
      + (CASE WHEN unaccent(${text}) ILIKE unaccent($3::text) THEN 5 ELSE 0 END))`;
    const queries = [
      `SELECT DISTINCT ON (d.id) d.id::text AS id,'documents'::text AS type,d.display_name AS title,
        concat_ws(' · ',b.protocol,t.name,person.display_name,${documentState},CASE WHEN j.failure_code IS NOT NULL THEN concat('Falha: ',j.failure_code) END) AS snippet,
        concat('/documents?documentId=',d.id) AS url,${relevance('d.display_name', documentText)} AS score,
        b.team_id,j.id::text AS translation_id,d.id::text AS document_id,b.id::text AS batch_id
        ${base} AND ${match(documentText)} ORDER BY d.id,j.created_at DESC`,
      `SELECT j.id::text AS id,'translations'::text AS type,concat_ws(' — ',b.protocol,d.display_name) AS title,
        concat_ws(' · ',${languageName('j.source_language')}||' → '||${languageName('j.target_language')},${translationState},person.display_name,t.name,CASE WHEN j.failure_code IS NOT NULL THEN concat('Falha: ',j.failure_code) END) AS snippet,
        concat('/translations/',j.id) AS url,${relevance("concat_ws(' ',b.protocol,d.display_name)", documentText)} AS score,
        b.team_id,j.id::text AS translation_id,d.id::text AS document_id,b.id::text AS batch_id
        ${base} AND j.id IS NOT NULL AND ${match(documentText)}`,
      `SELECT b.id::text AS id,'protocols'::text AS type,coalesce(b.protocol,'Sem protocolo') AS title,
        concat_ws(' · ',b.name,t.name,b.no_protocol_reason,string_agg(d.display_name,' · ' ORDER BY d.position)) AS snippet,
        concat('/documents?batchId=',b.id) AS url,${relevance("coalesce(b.protocol,'Sem protocolo')", "concat_ws(' ',b.protocol,b.name,t.name,b.no_protocol_reason,string_agg(d.display_name,' '))")} AS score,
        b.team_id,NULL::text AS translation_id,NULL::text AS document_id,b.id::text AS batch_id
        FROM batches b LEFT JOIN teams t ON t.id=b.team_id LEFT JOIN documents d ON d.batch_id=b.id LEFT JOIN users owner ON owner.id=b.owner_id
        WHERE ($1::uuid[] IS NULL OR b.team_id=ANY($1::uuid[])) GROUP BY b.id,t.name
        HAVING ${match("concat_ws(' ',b.protocol,b.name,b.no_protocol_reason,t.name,max(owner.display_name),string_agg(d.display_name,' '))")}`,
      `SELECT a.id::text AS id,'audit'::text AS type,a.action AS title,
        concat_ws(' · ',coalesce(u.display_name,'Sistema'),t.name,
          CASE (${severitySql}) WHEN 'critical' THEN 'Emergência' WHEN 'error' THEN 'Erro' WHEN 'warning' THEN 'Atenção' ELSE 'Registro' END,
          coalesce(a.metadata->>'protocol',a.metadata->>'documentName'),
          coalesce(a.metadata->>'comment',a.metadata->>'reason',a.metadata->>'explanation')) AS snippet,
        concat('/audit?q=',a.id) AS url,${relevance('a.action', auditText)} AS score,
        a.team_id,CASE WHEN a.target_type='translation' THEN a.target_id END AS translation_id,
        CASE WHEN a.target_type='document' THEN a.target_id END AS document_id,CASE WHEN a.target_type='batch' THEN a.target_id END AS batch_id
        FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN teams t ON t.id=a.team_id
        WHERE ($1::uuid[] IS NULL OR a.team_id=ANY($1::uuid[])) AND ${match(auditText)}`,
      `SELECT j.id::text AS id,'reports'::text AS type,concat('Relatório · ',d.display_name) AS title,
        concat_ws(' · ',b.protocol,t.name,person.display_name,${translationState},concat('Devoluções: ',j.redo_count),CASE WHEN j.failure_code IS NOT NULL THEN concat('Falha: ',j.failure_code) END) AS snippet,
        concat('/reports?translationId=',j.id) AS url,${relevance('d.display_name', documentText)} AS score,
        b.team_id,j.id::text AS translation_id,d.id::text AS document_id,b.id::text AS batch_id
        ${base} AND j.id IS NOT NULL AND ${match(documentText)}`,
      `SELECT t.id::text AS id,'teams'::text AS type,t.name::text AS title,
        concat('Equipe · ',count(m.user_id),' pessoa(s)') AS snippet,concat('/teams/',t.id) AS url,
        ${relevance('t.name::text', 't.name::text')} AS score,t.id AS team_id,NULL::text AS translation_id,NULL::text AS document_id,NULL::text AS batch_id
        FROM teams t LEFT JOIN team_memberships m ON m.team_id=t.id
        WHERE ($1::uuid[] IS NULL OR t.id=ANY($1::uuid[])) AND ${match('t.name::text')} GROUP BY t.id`,
    ];
    const results = await Promise.all(
      queries.map((sql) =>
        pool.query<SearchRow>(
          `WITH matches AS (${sql})
      SELECT *,count(*) OVER()::int AS total FROM matches ORDER BY score DESC,title,id LIMIT $4`,
          params,
        ),
      ),
    );
    let total = 0;
    for (const result of results) {
      total += result.rows[0]?.total ?? 0;
      for (const row of result.rows)
        groups[row.type].push({
          id: row.id,
          type: row.type,
          title: row.title,
          snippet: row.snippet.slice(0, 700),
          url: row.url,
          score: row.score,
          teamId: row.team_id,
          ...(row.translation_id ? { translationId: row.translation_id } : {}),
          ...(row.document_id ? { documentId: row.document_id } : {}),
          ...(row.batch_id ? { batchId: row.batch_id } : {}),
        });
    }
    return { query: q, tokens, total, groups };
  }
  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;

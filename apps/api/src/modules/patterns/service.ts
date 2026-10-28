import { lookupMemory } from '@tradutor/core/crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { draftFromFile, extractFile, loadLayoutKnowledge } from '@tradutor/core/processing';
import {
  loadRules,
  renderPlainDocx,
  type Draft,
  type GlossaryTerm,
  type Language,
  type MachineProviderName,
  type MachineProviderSetting,
  type MachineTranslator,
  type Mode,
} from '@tradutor/core/translation';
import { isDirector } from '../access/policy.js';
import { AppError } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { detectFormat } from '../documents/format.js';
import { applyTrialPreset, createPatternTrialService, trialDto, type LayoutPreset } from './trials.js';

/**
 * Padrões de documento (ADR-017): o que o sistema já fez de cada tipo e, para um tipo novo, um teste que diz se ele
 * consegue fazer — sem criar tradução nem guardar o arquivo.
 */

export type Verdict = 'can' | 'review' | 'cannot';

export const verdictLabel: Record<Verdict, string> = {
  can: 'Consegue fazer',
  review: 'Consegue, com conferência',
  cannot: 'Ainda não consegue',
};

interface PatternRow {
  title: string;
  document_type: string | null;
  total: number;
  approved: number;
  clean: number;
  failed: number;
  active: number;
  processed: number;
  without_text: number;
  avg_errors: number | null;
  avg_corrections: number | null;
  last_errors: number | null;
  last_at: Date;
  formats: string[];
  pairs: string[];
  modes: Mode[];
}

export function createPatternService(deps: ServiceDeps & { machine?: Partial<Record<MachineProviderName, MachineTranslator>> }) {
  const { pool, machine = {} } = deps;
  const trials = createPatternTrialService(deps);
  const teamsOf = (ctx: AuthenticatedContext) => (isDirector(ctx.actor) ? null : [...ctx.actor.memberships.keys()]);

  async function list(ctx: AuthenticatedContext) {
    const teams = teamsOf(ctx);
    const result = await pool.query<PatternRow>(
      `WITH jobs AS (
         SELECT j.*, upper(coalesce(nullif(j.source_title, ''), nullif(j.document_type, ''), '(sem título)')) AS key,
                coalesce(nullif(j.source_title, ''), nullif(j.document_type, ''), '(sem título)') AS title,
                v.format,
                r.error_count AS errors,
                r.correction_count AS corrections
           FROM translation_jobs j
           JOIN documents d ON d.id = j.document_id
           JOIN batches b ON b.id = d.batch_id
           LEFT JOIN document_versions v ON v.document_id = d.id AND v.kind = 'original'
           LEFT JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
          WHERE j.status <> 'cancelled' AND ($1::uuid[] IS NULL OR b.team_id = ANY($1::uuid[]))
       )
       SELECT (array_agg(title ORDER BY created_at DESC))[1] AS title,
              (array_agg(document_type ORDER BY created_at DESC) FILTER (WHERE document_type IS NOT NULL))[1] AS document_type,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'approved' AND approval_override_reason IS NULL AND annulled_at IS NULL)::int AS clean,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status IN ('queued', 'processing', 'in_review', 'awaiting_approval'))::int AS active,
              count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed,
              count(*) FILTER (WHERE processed_at IS NOT NULL AND extracted_text IS NULL)::int AS without_text,
              round(avg(errors) FILTER (WHERE processed_at IS NOT NULL), 1)::float AS avg_errors,
              round(avg(corrections) FILTER (WHERE processed_at IS NOT NULL), 1)::float AS avg_corrections,
              (array_agg(errors ORDER BY created_at DESC) FILTER (WHERE processed_at IS NOT NULL))[1] AS last_errors,
              max(created_at) AS last_at,
              array_remove(array_agg(DISTINCT format), NULL) AS formats,
              array_agg(DISTINCT source_language || '-' || target_language) AS pairs,
              array_agg(DISTINCT translation_mode) AS modes
         FROM jobs GROUP BY key ORDER BY max(created_at) DESC LIMIT 300`,
      [teams],
    );
    return {
      items: result.rows.map((row) => {
        const { verdict, reasons } = historyVerdict(row);
        return {
          title: row.title,
          documentType: row.document_type,
          verdict,
          verdictLabel: verdictLabel[verdict],
          reasons,
          total: row.total,
          approved: row.approved,
          failed: row.failed,
          active: row.active,
          averageErrors: row.avg_errors ?? 0,
          averageCorrections: row.avg_corrections ?? 0,
          lastAt: row.last_at.toISOString(),
          formats: row.formats,
          pairs: row.pairs,
          modes: row.modes,
        };
      }),
    };
  }

  /** O arquivo/texto não é guardado. Persistem apenas digests, diagramação sem texto e decisões do ensaio. */
  async function test(
    ctx: AuthenticatedContext,
    file: { data: Buffer; name: string },
    input: {
      sourceLanguage: Language;
      targetLanguage: Language;
      mode: Mode;
      layoutPreset?: LayoutPreset | undefined;
      documentCategory?: import('@tradutor/core/translation').BodyModel;
    },
  ) {
    if (input.sourceLanguage === input.targetLanguage) throw new AppError(400, 'VALIDATION_FAILED', 'Idiomas de origem e destino iguais');
    const trial = await trials.begin(ctx, file.data, input);
    const started = performance.now();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'padrao-'));
    let format: string;
    try {
      const target = path.join(dir, 'arquivo');
      await writeFile(target, file.data);
      const detected = await detectFormat(target);
      if (!detected.ok) {
        return {
          ...refusal(
            detected.reason === 'protected_or_legacy'
              ? 'Arquivo protegido por senha ou em formato antigo (.doc/.ppt): salve como PDF ou DOCX.'
              : 'Formato não reconhecido: envie PDF, DOCX, PPTX, JPG ou PNG.',
          ),
          trial: trialDto(trial),
        };
      }
      format = detected.format;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const data = new Uint8Array(file.data);
    const extraction = await extractFile(data, format, input.sourceLanguage);
    if (!extraction?.hasTextLayer) {
      return {
        ...refusal(
          format === 'jpeg' || format === 'png' || extraction?.ocr
            ? 'Não foi possível ler texto na imagem (OCR sem resultado ou indisponível): envie uma imagem mais nítida, o PDF com texto ou o DOCX.'
            : 'O arquivo não tem texto que o sistema consiga ler (PDF digitalizado sem OCR disponível). Envie a versão com texto.',
          format,
          extraction?.pages ?? null,
        ),
        trial: trialDto(trial),
      };
    }
    const teams = teamsOf(ctx);
    const rules = await loadRules(pool, input.mode, input.targetLanguage);
    const glossary = (
      await pool.query<GlossaryTerm>(
        `SELECT source_term::text AS source, target_term AS target FROM glossary_entries
          WHERE source_language = $1 AND target_language = $2 AND (team_id IS NULL OR $3::uuid[] IS NULL OR team_id = ANY($3::uuid[]))
          ORDER BY team_id NULLS FIRST, source_term`,
        [input.sourceLanguage, input.targetLanguage, teams],
      )
    ).rows;
    const example = (
      await pool.query<{ content: Draft; title: string; approved: number }>(
        `SELECT r.content, j.source_title AS title, count(*) OVER ()::int AS approved
           FROM translation_jobs j JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
          WHERE j.status = 'approved' AND j.approval_override_reason IS NULL AND j.annulled_at IS NULL
            AND j.source_language = $1 AND j.target_language = $2
            AND j.source_title IS NOT NULL AND length(j.source_title) >= 6 AND position(upper(j.source_title) IN upper($3)) > 0
          ORDER BY j.approved_at DESC LIMIT 1`,
        [input.sourceLanguage, input.targetLanguage, extraction.text],
      )
    ).rows[0];
    const setting =
      (await pool.query<{ provider: MachineProviderSetting }>('SELECT provider FROM machine_translation_settings')).rows[0]?.provider ??
      'libretranslate';
    const translator = setting === 'none' ? null : (machine[setting] ?? null);
    const result = await draftFromFile({
      data,
      format,
      extraction,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      rules,
      glossary,
      memory: (segments) => lookupMemory(pool, input.sourceLanguage, input.targetLanguage, segments),
      known: example ? { documentType: example.content.documentType, sourceTitle: example.content.sourceTitle } : null,
      translator,
      knowledge: await loadLayoutKnowledge(pool),
      ...(input.documentCategory ? { documentCategory: input.documentCategory } : {}),
      ...(translator ? {} : { noTranslatorNotice: 'Sem tradutor automático no ar: o teste mostra só a estrutura do documento.' }),
    });

    const sourceDraft = result.draft;
    const preset = trial.requires_regeneration ? trial.layout_preset : (input.layoutPreset ?? trial.layout_preset);
    result.draft = applyTrialPreset(result.draft, preset);
    const savedTrial = await trials.complete(ctx, trial, sourceDraft, result.draft, preset, {
      font: rules.font,
      fontSize: rules.fontSize,
      statement: rules.statement,
      issuedDate: rules.statement ? new Date().toISOString().slice(0, 10) : null,
    });
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    const blocks = result.draft.blocks;
    const count = (kind: string) => blocks.filter((block) => block.kind === kind).length;
    const reasons: string[] = [];
    let verdict: Verdict = 'can';
    if (!translator || result.machineFailure) {
      verdict = 'review';
      reasons.push(
        result.machineFailure
          ? `A tradução automática falhou: ${result.machineFailure.message}`
          : 'Tradutor automático fora do ar no teste.',
      );
    }
    if (extraction.ocr) {
      verdict = 'review';
      reasons.push(
        `Texto lido por OCR (confiança média ${extraction.ocr.confidence}%): o fluxo segue, mas nomes, números e datas pedem conferência com o original.`,
      );
    }
    if (!result.layout?.blocks.length && !extraction.ocr) {
      verdict = 'review';
      reasons.push('A estrutura do original (tabelas, títulos) não foi reconhecida; o texto sai em parágrafos.');
    }
    if (errors.length) {
      verdict = 'review';
      reasons.push(
        `${errors.length} problema(s) de checagem depois da revisão automática (${[...new Set(errors.map((issue) => issue.code))].join(', ')}).`,
      );
    }
    if (result.unresolved.length) {
      verdict = 'review';
      reasons.push(`${result.unresolved.length} ponto(s) que a revisão automática não corrigiu sozinha.`);
    }
    if (verdict === 'can')
      reasons.push('Texto lido, estrutura reconhecida, traduzido e revisado sem problemas de checagem: o fluxo segue sozinho até o Word.');
    if (!example)
      reasons.push(
        result.composedFrom.length
          ? `Tipo novo: a diagramação foi construída combinando ${result.composedFrom.length} documento(s) conhecido(s) de estrutura parecida.`
          : 'Tipo novo e sem documento conhecido parecido: a diagramação segue a estrutura do original.',
      );

    return {
      trial: savedTrial,
      verdict,
      verdictLabel: verdictLabel[verdict],
      reasons,
      format,
      pages: extraction.pages,
      words: (extraction.text.match(/\p{L}{2,}/gu) ?? []).length,
      structure: {
        tables: count('table'),
        headings: count('heading'),
        paragraphs: count('paragraph'),
        signatures: count('signature'),
        markers: blocks.filter((block) => block.kind === 'paragraph' && /^\[[^\]]+\]$/.test(block.text.trim())).length,
      },
      known: example ? { title: example.title, approved: example.approved } : null,
      /** Documentos conhecidos combinados na diagramação (ADR-020). */
      composedFrom: result.composedFrom,
      bodyModel: result.bodyModel,
      documentType: result.draft.documentType,
      sourceTitle: result.draft.sourceTitle,
      notice: result.notice,
      corrections: result.corrections,
      unresolved: result.unresolved,
      issues: result.issues,
      draft: result.draft,
      durationMs: Math.round(performance.now() - started),
      /** Word da prévia do teste, no layout e na fonte da regra (base64). */
      previewDocx: (
        await renderPlainDocx(result.draft, {
          look: rules,
          draft: true,
          statement: rules.statement,
          translatorName: null,
          issuedAt: new Date(),
        })
      ).toString('base64'),
    };
  }

  return { list, test, inspectTrial: trials.inspect, registerTrialFormat: trials.registerFormat, getTrial: trials.get };
}

function refusal(reason: string, format: string | null = null, pages: number | null = null) {
  return {
    verdict: 'cannot' as Verdict,
    verdictLabel: verdictLabel.cannot,
    reasons: [reason],
    format,
    pages,
    words: 0,
    structure: null,
    known: null,
    documentType: '',
    sourceTitle: '',
    notice: null,
    corrections: [],
    unresolved: [],
    issues: [],
    draft: null,
    durationMs: 0,
    previewDocx: null,
  };
}

/** Veredito pelo histórico real do tipo: conclusões limpas, falhas, texto legível e problemas restantes. */
function historyVerdict(row: PatternRow): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (row.processed > 0 && row.without_text === row.processed) {
    return { verdict: 'cannot', reasons: ['Os arquivos deste tipo não têm texto legível (imagem ou digitalizado): falta OCR.'] };
  }
  if (row.failed === row.total) return { verdict: 'cannot', reasons: ['Todas as tentativas de processar falharam.'] };
  if (row.clean > 0 && (row.last_errors ?? 0) === 0) {
    reasons.push(`${row.clean} conclusão(ões) sem problema de checagem; o último processamento saiu limpo.`);
    if (row.failed) reasons.push(`${row.failed} falha(s) de processamento no histórico.`);
    return { verdict: 'can', reasons };
  }
  if (!row.clean)
    reasons.push(row.approved ? 'As conclusões deste tipo precisaram de justificativa.' : 'Ainda sem tradução concluída deste tipo.');
  if ((row.last_errors ?? 0) > 0) reasons.push(`O último processamento ficou com ${row.last_errors} problema(s) de checagem.`);
  if (row.without_text) reasons.push(`${row.without_text} arquivo(s) sem texto legível.`);
  if (row.failed) reasons.push(`${row.failed} falha(s) de processamento.`);
  return { verdict: 'review', reasons };
}

export type PatternService = ReturnType<typeof createPatternService>;

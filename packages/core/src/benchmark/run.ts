import { draftFromFile } from '../processing/analyze.js';
import { BODY_MODEL_SPECS } from '../translation/body-models.js';
import { draftText, type GlossaryTerm } from '../translation/checks.js';
import { structuralProblems, type Language } from '../translation/draft.js';
import { confidentLanguage } from '../translation/language-detect.js';
import type { MachineTranslator } from '../translation/machine/providers.js';
import { defaultRules } from '../translation/profiles.js';
import { SEEDED_GLOSSARY } from '../translation/skill-glossary.js';
import { BENCHMARK_CORPUS, type BenchmarkSample } from './corpus.js';

/**
 * Bateria de eficiência da tradução (28/10/2026): cada documento da bateria passa pelo mesmo caminho do worker
 * (`draftFromFile`: leitura, tradução, modelo de corpo, revisão automática e checagens), sem banco, com o glossário
 * que a migração semeia. Cada critério conferido vale um ponto; a eficiência é a parte dos pontos obtidos.
 *
 * Dois modos:
 * - `real`: com o LibreTranslate (ou o DeepL) configurado; mede também se o texto saiu traduzido e no idioma certo.
 * - `simulado`: sem provedor (ambiente de testes). Um tradutor simulado devolve o texto com as falhas típicas dos
 *   provedores (marcadores com colchete faltando, maiúsculas trocadas, marcador perdido), e a bateria mede o que o
 *   sistema controla: tipo do documento, terminologia, números e datas, estrutura e revisão. A fluência da tradução
 *   automática fica de fora, porque depende do provedor.
 */

export type Criterion =
  | 'category'
  | 'document_type'
  | 'terminology'
  | 'numbers'
  | 'structure'
  | 'completeness'
  | 'consistency'
  | 'translated'
  | 'language';

export const CRITERION_LABEL: Record<Criterion, string> = {
  category: 'Tipo do documento reconhecido',
  document_type: 'Título do tipo no idioma de destino',
  terminology: 'Terminologia aprovada aplicada',
  numbers: 'Números, datas e códigos preservados',
  structure: 'Estrutura e tabelas íntegras',
  completeness: 'Sem bloco vazio e com tipo preenchido',
  consistency: 'Glossário aplicado em todo o texto',
  translated: 'Texto traduzido (não ficou no original)',
  language: 'Texto no idioma de destino',
};

export interface BenchmarkCheck {
  sample: string;
  country: BenchmarkSample['country'];
  category: BenchmarkSample['category'];
  source: Language;
  target: Language;
  criterion: Criterion;
  passed: boolean;
  detail?: string;
}

export type BenchmarkLevel = 'meta' | 'atencao' | 'alerta' | 'critico';

/** Faixas pedidas: 99% ou mais é a meta; 95% é alerta; 90% é crítico. Entre 95% e 99%, abaixo da meta (atenção). */
export const levelOf = (score: number): BenchmarkLevel =>
  score >= 99 ? 'meta' : score > 95 ? 'atencao' : score > 90 ? 'alerta' : 'critico';

export const LEVEL_LABEL: Record<BenchmarkLevel, string> = {
  meta: 'Meta atingida (99% ou mais)',
  atencao: 'Abaixo da meta (entre 95% e 99%)',
  alerta: 'Alerta (95% ou menos)',
  critico: 'Crítico (90% ou menos)',
};

export interface BenchmarkReport {
  mode: 'real' | 'simulado';
  provider: string;
  runs: number;
  checks: BenchmarkCheck[];
  score: number;
  level: BenchmarkLevel;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Glossário como fica no banco depois da migração: o primeiro termo de cada par vence (ON CONFLICT DO NOTHING). */
export function seededGlossary(source: Language, target: Language): GlossaryTerm[] {
  const seen = new Set<string>();
  const terms: GlossaryTerm[] = [];
  for (const group of SEEDED_GLOSSARY) {
    if (group.source !== source || group.target !== target) continue;
    for (const term of group.terms) {
      const key = term.source.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({ source: term.source, target: term.target });
    }
  }
  return terms;
}

/**
 * Tradutor simulado: devolve o trecho protegido como veio, com as falhas que os provedores costumam causar nos
 * marcadores. A cada sete trechos, um marcador some de vez (o sistema precisa manter o original nesse trecho).
 */
export function simulatedTranslator(): MachineTranslator {
  let counter = 0;
  return {
    name: 'libretranslate',
    external: false,
    async isAvailable() {
      return true;
    },
    async translate(texts) {
      return texts.map((text) => {
        counter += 1;
        if (counter % 7 === 3) return text.replace(/\[\[[A-Z]\d+\]\]/, '');
        if (counter % 3 === 0) return text.replace(/\[\[([A-Z]\d+)\]\]/, '[$1]');
        if (counter % 4 === 1)
          return text.replace(/\[\[([A-Z])(\d+)\]\]/, (_match, prefix: string, index: string) => `[[ ${prefix.toLowerCase()}${index} ]]`);
        return text;
      });
    },
  };
}

async function runSample(sample: BenchmarkSample, target: Language, translator: MachineTranslator, real: boolean) {
  const glossary = seededGlossary(sample.source, target);
  const output = await draftFromFile({
    data: new Uint8Array(),
    format: 'txt',
    extraction: { text: sample.text, pages: 1, hasTextLayer: true, rotatedText: [] },
    sourceLanguage: sample.source,
    targetLanguage: target,
    rules: defaultRules('sworn', target),
    glossary,
    memory: async () => new Map(),
    known: null,
    translator,
  });
  const checks: BenchmarkCheck[] = [];
  const add = (criterion: Criterion, passed: boolean, detail?: string) =>
    checks.push({
      sample: sample.id,
      country: sample.country,
      category: sample.category,
      source: sample.source,
      target,
      criterion,
      passed,
      ...(passed || !detail ? {} : { detail }),
    });
  const issues = output.issues;
  const text = fold(draftText(output.draft));

  add('category', output.bodyModel === sample.category, `reconhecido como "${output.bodyModel}", esperado "${sample.category}"`);
  const expectedType = BODY_MODEL_SPECS[sample.category].type[target];
  add('document_type', output.draft.documentType === expectedType, `"${output.draft.documentType}", esperado "${expectedType}"`);
  for (const term of sample.keyTerms) {
    const entry = glossary.find((item) => fold(item.source) === fold(term));
    if (!entry) add('terminology', false, `"${term}": sem tradução aprovada no glossário ${sample.source}→${target}`);
    else add('terminology', text.includes(fold(entry.target)), `"${term}" → "${entry.target}" não aparece no rascunho`);
  }
  const of = (code: string) => issues.filter((issue) => issue.code === code);
  add(
    'numbers',
    !of('number_missing').length,
    of('number_missing')
      .map((issue) => issue.token ?? issue.message)
      .join('; '),
  );
  const structure = [...structuralProblems(output.draft), ...of('structure').map((issue) => issue.message)];
  add('structure', !structure.length, structure.join('; '));
  const incomplete = [...of('empty_block'), ...of('missing_document_type')];
  add('completeness', !incomplete.length, incomplete.map((issue) => issue.message).join('; '));
  add(
    'consistency',
    !of('glossary_not_applied').length,
    of('glossary_not_applied')
      .map((issue) => issue.token)
      .join('; '),
  );
  if (real) {
    add(
      'translated',
      !of('untranslated').length,
      of('untranslated')
        .map((issue) => issue.message)
        .join('; '),
    );
    const detected = confidentLanguage(draftText(output.draft));
    add('language', detected === null || detected === target, `texto detectado como "${detected}"`);
  }
  return checks;
}

/** Roda a bateria inteira (ou só as amostras escolhidas) e devolve os pontos de cada critério. */
export async function runBenchmark(
  options: { translator?: MachineTranslator | null; samples?: BenchmarkSample[] } = {},
): Promise<BenchmarkReport> {
  const real = Boolean(options.translator);
  const translator = options.translator ?? simulatedTranslator();
  const checks: BenchmarkCheck[] = [];
  let runs = 0;
  for (const sample of options.samples ?? BENCHMARK_CORPUS)
    for (const target of sample.targets) {
      checks.push(...(await runSample(sample, target, translator, real)));
      runs += 1;
    }
  const score = scoreOf(checks);
  return { mode: real ? 'real' : 'simulado', provider: real ? translator.name : 'simulado', runs, checks, score, level: levelOf(score) };
}

export const scoreOf = (checks: BenchmarkCheck[]) =>
  checks.length ? Math.round((checks.filter((check) => check.passed).length / checks.length) * 1000) / 10 : 100;

const percent = (value: number) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Relatório em Markdown: resultado geral, por critério, por tipo, por país e por par de idiomas, e as falhas. */
export function formatReport(report: BenchmarkReport, title = 'Bateria de eficiência da tradução') {
  const group = <K extends string>(key: (check: BenchmarkCheck) => K) => {
    const groups = new Map<K, BenchmarkCheck[]>();
    for (const check of report.checks) groups.set(key(check), [...(groups.get(key(check)) ?? []), check]);
    return [...groups.entries()].map(([name, checks]) => ({ name, checks, score: scoreOf(checks) }));
  };
  const table = (heading: string, rows: Array<{ name: string; checks: BenchmarkCheck[]; score: number }>, label = (name: string) => name) =>
    [
      `| ${heading} | Pontos | Eficiência | Faixa |`,
      '| --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${label(row.name)} | ${row.checks.filter((check) => check.passed).length}/${row.checks.length} | ${percent(row.score)} | ${LEVEL_LABEL[levelOf(row.score)]} |`,
      ),
    ].join('\n');
  const failures = report.checks.filter((check) => !check.passed);
  return [
    `# ${title}`,
    '',
    `- Modo: ${report.mode === 'real' ? `tradução automática real (${report.provider})` : 'tradutor simulado (sem provedor de tradução neste ambiente)'}`,
    `- Traduções feitas: ${report.runs}`,
    `- Pontos: ${report.checks.filter((check) => check.passed).length} de ${report.checks.length}`,
    `- Eficiência: **${percent(report.score)}**: ${LEVEL_LABEL[report.level]}`,
    '',
    '## Por critério',
    '',
    table(
      'Critério',
      group((check) => check.criterion),
      (name) => CRITERION_LABEL[name as Criterion],
    ),
    '',
    '## Por tipo de documento',
    '',
    table(
      'Tipo',
      group((check) => check.category),
      (name) => BODY_MODEL_SPECS[name as BenchmarkCheck['category']].label,
    ),
    '',
    '## Por país de origem',
    '',
    table(
      'País',
      group((check) => check.country),
    ),
    '',
    '## Por par de idiomas',
    '',
    table(
      'Par',
      group((check) => `${check.source} → ${check.target}`),
    ),
    '',
    '## Falhas',
    '',
    failures.length
      ? failures
          .map(
            (check) =>
              `- ${check.sample} (${check.source} → ${check.target}), ${CRITERION_LABEL[check.criterion]}: ${check.detail ?? 'falhou'}`,
          )
          .join('\n')
      : 'Nenhuma.',
    '',
  ].join('\n');
}

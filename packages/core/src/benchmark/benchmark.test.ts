import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEEDED_GLOSSARY } from '../translation/skill-glossary.js';
import { BENCHMARK_CORPUS, BENCHMARK_HOLDOUT } from './corpus.js';
import { levelOf, runBenchmark } from './run.js';

describe('bateria de eficiência da tradução (tipos documentais)', () => {
  it('bateria principal e de validação ficam na meta (99% ou mais) com o tradutor simulado', async () => {
    for (const samples of [BENCHMARK_CORPUS, BENCHMARK_HOLDOUT]) {
      const report = await runBenchmark({ samples });
      const failures = report.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.sample} ${check.target} ${check.criterion}: ${check.detail}`);
      assert.ok(report.score >= 99, `eficiência ${report.score}%:\n${failures.join('\n')}`);
    }
  });

  it('faixas: meta, abaixo da meta, alerta e crítico', () => {
    assert.equal(levelOf(100), 'meta');
    assert.equal(levelOf(99), 'meta');
    assert.equal(levelOf(97), 'atencao');
    assert.equal(levelOf(95), 'alerta');
    assert.equal(levelOf(90), 'critico');
  });

  it('um termo tem uma só tradução por par de idiomas no glossário semeado', () => {
    const seen = new Map<string, string>();
    for (const group of SEEDED_GLOSSARY)
      for (const term of group.terms) {
        const key = `${group.source}>${group.target}:${term.source.toLocaleLowerCase('pt-BR')}`;
        assert.ok(!seen.has(key) || seen.get(key) === term.target, `"${term.source}" (${group.source}→${group.target}) com duas traduções`);
        seen.set(key, term.target);
      }
  });

  it('amostras fictícias: sem nomes reais, todas marcadas como fictícias', () => {
    for (const sample of [...BENCHMARK_CORPUS, ...BENCHMARK_HOLDOUT])
      assert.match(sample.text, /FICT[IÍ]CI[OA]|FICTITIOUS|FICTI[FV]E?|FITTIZI[OA]|FICTICI[OA]/u, sample.id);
  });
});

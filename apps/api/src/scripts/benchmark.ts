import { writeFileSync } from 'node:fs';
import { BENCHMARK_CORPUS, BENCHMARK_HOLDOUT, formatReport, runBenchmark } from '@tradutor/core/benchmark';
import { withFileSecrets } from '@tradutor/core/crypto';
import { machineTranslatorsFromEnv } from '@tradutor/core/translation';

/**
 * Bateria de eficiência da tradução (CNN, antecedentes, atestados, conselhos, divórcio, procuração, ementa e
 * certidões). Com o LibreTranslate (ou o DeepL) do ambiente no ar, mede a tradução real; sem provedor, roda com o
 * tradutor simulado. `--saida arquivo.md` grava o relatório; sem ela, o relatório sai na tela.
 *
 *   docker compose exec api pnpm --filter @tradutor/api benchmark --saida relatorio-bateria.md
 */
const env = withFileSecrets(process.env);
const output = process.argv.includes('--saida') ? process.argv[process.argv.indexOf('--saida') + 1] : undefined;
const log = (message: string) => process.stderr.write(`${message}\n`);

const providers = machineTranslatorsFromEnv({
  ...(env.LIBRETRANSLATE_URL ? { LIBRETRANSLATE_URL: env.LIBRETRANSLATE_URL } : {}),
  ...(env.LIBRETRANSLATE_API_KEY ? { LIBRETRANSLATE_API_KEY: env.LIBRETRANSLATE_API_KEY } : {}),
  ...(env.DEEPL_API_KEY ? { DEEPL_API_KEY: env.DEEPL_API_KEY } : {}),
});
const translator = providers.libretranslate ?? providers.deepl ?? null;
const available = translator ? await translator.isAvailable() : false;
if (!available) log('Sem provedor de tradução no ar: a bateria roda com o tradutor simulado (não mede a fluência da tradução).');
else log(`Provedor: ${translator!.name}. A primeira tradução de cada par de idiomas demora mais.`);

const sections: string[] = [];
let worst = 100;
for (const [title, samples] of [
  ['Bateria principal', BENCHMARK_CORPUS],
  ['Bateria de validação', BENCHMARK_HOLDOUT],
] as const) {
  log(`${title}: ${samples.reduce((sum, sample) => sum + sample.targets.length, 0)} tradução(ões)…`);
  const report = await runBenchmark({ translator: available ? translator : null, samples });
  log(`${title}: ${report.score}%`);
  worst = Math.min(worst, report.score);
  sections.push(formatReport(report, title));
}
const text = sections.join('\n');
if (output) {
  writeFileSync(output, text);
  log(`Relatório gravado em ${output}`);
} else process.stdout.write(text);
// Abaixo de 95% (alerta) o comando termina com erro, para servir de verificação automática.
process.exit(worst > 95 ? 0 : 1);

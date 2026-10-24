import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { before, describe, it } from 'node:test';
import { Document, Packer, Paragraph } from 'docx';
import { draftFromFile, extractFile } from '../../processing/analyze.js';
import { extractOfficeText } from '../extract-office.js';
import { defaultRules } from '../profiles.js';
import { renderPlainDocx } from '../render-docx.js';
import type { Language } from '../draft.js';
import { createLibreTranslate } from './providers.js';

/** Opt-in test uses only synthetic text and the real local provider; no database, AI, or outside service. */
const enabled = process.env.RUN_LIVE_TRANSLATION_TESTS === 'true';
const baseUrl = process.env.LIVE_LIBRETRANSLATE_URL ?? 'http://localhost:15050';
const evidenceDir = process.env.LIVE_TRANSLATION_EVIDENCE_DIR;
const translator = createLibreTranslate(baseUrl);
const pairs: Array<{ from: Language; to: Language; source: string; targetWords: RegExp }> = [
  { from: 'fr', to: 'es', source: 'Bonjour, ce document confirme la réception du paiement.', targetWords: /Hola.*documento.*pago/i },
  {
    from: 'es',
    to: 'it',
    source: 'Hola, este documento confirma la recepción del pago.',
    targetWords: /(?:Ciao|Salve).*documento.*pagamento/i,
  },
];

describe('pares multilíngues com LibreTranslate local real, sem IA', { skip: !enabled, timeout: 300_000 }, () => {
  before(async () => {
    const response = await fetch(`${baseUrl}/languages`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const languages = (await response.json()) as Array<{ code: string; targets: string[] }>;
    for (const pair of pairs)
      assert.ok(
        languages.find((language) => language.code === pair.from)?.targets.includes(pair.to),
        `${pair.from}→${pair.to} precisa estar disponível`,
      );
    assert.equal(translator.external, false);
    assert.equal(await translator.isAvailable(), true);
  });

  for (const pair of pairs)
    it(`${pair.from}→${pair.to}: provedor, DOCX original, extração, rascunho real e Word gerado`, { timeout: 180_000 }, async (t) => {
      const direct = await translator.translate([pair.source], pair.from, pair.to);
      assert.equal(direct.length, 1);
      assert.notEqual(direct[0], pair.source);
      assert.match(direct[0]!, pair.targetWords);

      const original = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(pair.source)] }] }));
      const extraction = await extractFile(original, 'docx', pair.from);
      assert.ok(extraction?.hasTextLayer);
      assert.match(extraction.text, new RegExp(pair.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const rules = defaultRules('simple', pair.to);
      const result = await draftFromFile({
        data: original,
        format: 'docx',
        extraction,
        sourceLanguage: pair.from,
        targetLanguage: pair.to,
        rules,
        glossary: [],
        memory: async () => new Map(),
        known: null,
        translator,
      });
      assert.equal(result.machineFailure, null);
      assert.equal(result.origin, 'machine');
      assert.ok((result.stats?.translated ?? 0) > 0);
      assert.equal(result.stats?.fromMemory, 0);
      assert.equal(result.draft.sourceLanguage, pair.from);
      assert.equal(result.draft.targetLanguage, pair.to);
      assert.ok(result.draft.blocks.some((block) => block.origin === 'machine'));
      const output = await renderPlainDocx(result.draft, { look: rules, draft: false, issuedAt: new Date('2026-10-24T12:00:00Z') });
      const generated = await extractOfficeText(output, 'docx');
      assert.match(generated.text, pair.targetWords);
      assert.notEqual(generated.text.trim(), pair.source);
      const evidence = {
        provider: translator.name,
        external: translator.external,
        aiUsed: false,
        pair: `${pair.from}→${pair.to}`,
        source: pair.source,
        providerResponse: direct[0],
        generatedText: generated.text,
        origin: result.origin,
        stats: result.stats,
        machineFailure: result.machineFailure,
        issues: result.issues,
      };
      t.diagnostic(JSON.stringify(evidence));
      if (evidenceDir) {
        const destination = resolve(evidenceDir);
        await mkdir(destination, { recursive: true });
        await Promise.all([
          writeFile(resolve(destination, `${pair.from}-${pair.to}-original.docx`), original),
          writeFile(resolve(destination, `${pair.from}-${pair.to}-traduzido.docx`), output),
          writeFile(resolve(destination, `${pair.from}-${pair.to}-evidence.json`), JSON.stringify(evidence, null, 2)),
        ]);
      }
    });
});

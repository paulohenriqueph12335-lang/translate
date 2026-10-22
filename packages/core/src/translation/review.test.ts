import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Draft } from './draft.js';
import { confidentLanguage } from './language-detect.js';
import type { MachineTranslator } from './machine/providers.js';
import { defaultRules } from './profiles.js';
import { autoReview } from './review.js';

const paragraph = (text: string, sourceText: string | null) =>
  ({ kind: 'paragraph', text, align: 'left', bold: false, size: 'normal', sourceText, origin: 'machine' }) as const;

const draft = (blocks: Draft['blocks'], targetLanguage: Draft['targetLanguage'] = 'fr'): Draft => ({
  sourceLanguage: 'pt',
  targetLanguage,
  documentType: 'ACTE DE NAISSANCE',
  sourceTitle: 'CERTIDÃO DE NASCIMENTO',
  blocks,
});

/** Tradutor falso: marca o idioma de destino e mantém marcadores ([[N0]]) intactos. */
const fake = (calls: string[][] = []): MachineTranslator => ({
  name: 'libretranslate',
  external: false,
  translate: async (texts, _from, to) => {
    calls.push(texts);
    return texts.map((text) => (to === 'fr' ? `Il est certifié que ${text.replace(/Certifico que /, '')}` : text));
  },
  isAvailable: async () => true,
});

describe('detecção de idioma', () => {
  it('reconhece os cinco idiomas e ignora nomes e códigos', () => {
    assert.equal(confidentLanguage('Certifico que o registro de nascimento foi lavrado neste cartório'), 'pt');
    assert.equal(confidentLanguage('I certify that the birth record was drawn up in this registry'), 'en');
    assert.equal(confidentLanguage("Je certifie que l'acte de naissance a été dressé dans ce bureau"), 'fr');
    assert.equal(confidentLanguage("Certifico che l'atto di nascita è stato redatto in questo ufficio"), 'it');
    assert.equal(confidentLanguage('Certifico que el acta de nacimiento fue extendida en esta oficina'), 'es');
    assert.equal(confidentLanguage('MARIANA ALVES TEIXEIRA'), null);
    assert.equal(confidentLanguage('CPF 000.000.000-00'), null);
  });
});

describe('revisão automática', () => {
  const rules = defaultRules('sworn', 'fr');

  it('retraduz o trecho que ficou no idioma errado e o que ficou sem tradução', async () => {
    const calls: string[][] = [];
    const result = await autoReview({
      draft: draft([
        paragraph(
          'Certifico que o registro foi lavrado neste cartório de registro civil',
          'Certifico que o registro foi lavrado neste cartório de registro civil',
        ),
        paragraph(
          'I certify that the record was drawn up in this office of the registry',
          'Certifico que o registro foi lavrado neste cartório',
        ),
        paragraph('MARIANA ALVES TEIXEIRA', 'MARIANA ALVES TEIXEIRA'),
      ]),
      sourceText: null,
      glossary: [],
      rules,
      translator: fake(calls),
    });
    assert.equal(calls.length, 1, 'um lote só');
    assert.deepEqual(
      result.corrections.map((item) => item.code),
      ['untranslated', 'wrong_language'],
    );
    const blocks = result.draft.blocks as Array<{ text: string }>;
    assert.match(blocks[0]!.text, /^Il est certifié que/);
    assert.match(blocks[1]!.text, /^Il est certifié que/);
    assert.equal(blocks[2]!.text, 'MARIANA ALVES TEIXEIRA');
  });

  it('sem tradutor, não inventa: deixa o trecho para a pessoa', async () => {
    const result = await autoReview({
      draft: draft([
        paragraph('I certify that the record was drawn up in this office', 'Certifico que o registro foi lavrado neste cartório'),
      ]),
      sourceText: null,
      glossary: [],
      rules,
      translator: null,
    });
    assert.equal(result.corrections.length, 0);
    assert.equal(result.unresolved.length, 1);
  });

  it('devolve números e datas ao formato da regra', async () => {
    const result = await autoReview({
      draft: draft([paragraph('Né le 03/14/2006, note 8.5, RG 12,345,678-9', 'Nascido em 14/03/2006, nota 8,5, RG 12.345.678-9')]),
      sourceText: null,
      glossary: [],
      rules,
      translator: null,
    });
    const text = (result.draft.blocks[0] as { text: string }).text;
    assert.equal(text, 'Né le 14 mars 2006, note 8,5, RG 12.345.678-9');
    assert.deepEqual(
      result.corrections.map((item) => item.code),
      ['date_format', 'number_restored', 'number_restored'],
    );
  });

  it('data por extenso com a vírgula perdida volta ao formato; célula vazia fica vazia', async () => {
    const result = await autoReview({
      draft: { ...draft([paragraph('Issued in September 5 2025.', 'Emitida em 05/09/2025.'), paragraph('', null)], 'en') },
      sourceText: null,
      glossary: [],
      rules: defaultRules('certified', 'en'),
      translator: null,
    });
    assert.deepEqual(
      (result.draft.blocks as Array<{ text: string }>).map((block) => block.text),
      ['Issued in September 5, 2025.', ''],
    );
    assert.deepEqual(result.unresolved, []);
  });

  it('aplica o glossário, acerta marcadores e troca nota do tradutor por marcador', async () => {
    const result = await autoReview({
      draft: draft([
        { kind: 'translator_note', text: 'Le document porte, en haut au centre, des armoiries.', sourceText: null, origin: 'rules' },
        paragraph('[Carimbo: Bureau]  Officier du Cartório', 'Carimbo do Oficial do Cartório'),
      ]),
      sourceText: null,
      glossary: [{ source: 'Cartório', target: "Bureau d'état civil" }],
      rules,
      translator: null,
    });
    const texts = (result.draft.blocks as Array<{ kind: string; text: string }>).map((block) => [block.kind, block.text]);
    assert.deepEqual(texts, [
      ['paragraph', '[Armoiries]'],
      ['paragraph', "[Cachet: Bureau] Officier du Bureau d'état civil"],
    ]);
    assert.deepEqual(
      result.corrections.map((item) => item.code),
      ['translator_note', 'spacing', 'marker_language', 'glossary'],
    );
  });

  it('trecho em terceiro idioma no original fica transcrito', async () => {
    const calls: string[][] = [];
    const result = await autoReview({
      draft: draft([paragraph('In God we trust and in the law of the land', 'In God we trust and in the law of the land')]),
      sourceText: null,
      glossary: [],
      rules,
      translator: fake(calls),
    });
    assert.equal(calls.length, 0);
    assert.equal(result.corrections.length, 0);
  });
});

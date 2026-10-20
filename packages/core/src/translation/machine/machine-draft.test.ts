import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { checkDraft } from '../checks.js';
import { extractPdfText } from '../extract-pdf.js';
import { analyzePdfLayout } from '../layout/pdf-layout.js';
import { isCodeLike } from '../codes.js';
import { buildMachineDraft, memoryKey, memoryPairs, prepareSegment } from './machine-draft.js';
import { createLibreTranslate, type MachineTranslator } from './providers.js';

const fixture = (name: string) => new URL(`../../../fixtures/historico-escolar/${name}`, import.meta.url);

/** Provedor simulado: prefixa "EN:" e registra o que recebeu. */
function fakeTranslator() {
  const calls: string[][] = [];
  const translator: MachineTranslator = {
    name: 'libretranslate',
    external: false,
    async translate(texts) {
      calls.push(texts);
      return texts.map((text) => `EN:${text}`);
    },
    async isAvailable() {
      return true;
    },
  };
  return { translator, calls };
}

const noMemory = async () => new Map<string, string>();

describe('rascunho por tradução automática', () => {
  it('converte datas e decimais sem tocar em identificadores', () => {
    assert.equal(prepareSegment('Nascimento: 14/03/2006, nota 8,5', 'pt', 'en'), 'Nascimento: 03/14/2006, nota 8.5');
    assert.equal(prepareSegment('RG 12.345.678-9 e RA 000.123.456-7', 'pt', 'en'), 'RG 12.345.678-9 e RA 000.123.456-7');
    assert.equal(prepareSegment('Vila Esperança, 15 de dezembro de 2023.', 'pt', 'en'), 'Vila Esperança, December 15, 2023.');
    assert.equal(prepareSegment('Grade 8.5 on 03/14/2006', 'en', 'pt'), 'Grade 8,5 on 14/03/2006');
    assert.equal(
      prepareSegment('1ª Série, 2ª Série, 3º ano, 11º, Registro nº 0458', 'pt', 'en'),
      '1st Série, 2nd Série, 3rd ano, 11th, Registro No. 0458',
    );
  });

  it('protege termos do glossário, pula trechos sem letras e monta tabelas de linhas "a | b"', async () => {
    const { translator, calls } = fakeTranslator();
    const result = await buildMachineDraft({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      extractedText: 'Histórico Escolar\nComponente | Nota\nLíngua Portuguesa | 8,5\n000.123.456-7',
      glossary: [{ source: 'Histórico Escolar', target: 'School Transcript' }],
      translator,
      memory: noMemory,
    });
    assert.deepEqual(calls[0], ['[[G0]]', 'Componente', 'Nota', 'Língua Portuguesa']);
    const [title, table, id] = result.draft.blocks;
    assert.equal(title?.kind === 'paragraph' && title.text, 'EN:School Transcript');
    assert.equal(table?.kind, 'table');
    if (table?.kind === 'table') {
      assert.deepEqual(
        table.rows.map((row) => row.cells.map((cell) => [cell.sourceText, cell.text])),
        [
          [
            ['Componente', 'EN:Componente'],
            ['Nota', 'EN:Nota'],
          ],
          [
            ['Língua Portuguesa', 'EN:Língua Portuguesa'],
            ['8,5', '8.5'],
          ],
        ],
      );
      assert.equal(table.origin, 'machine');
    }
    assert.equal(id?.kind === 'paragraph' && [id.text, id.origin].join(' '), '000.123.456-7 rules');
    assert.equal(result.stats.translated, 4);
  });

  it('números e identificadores vão protegidos ao provedor e voltam intactos', async () => {
    const calls: string[][] = [];
    // Provedor "malicioso" que troca separadores fora dos marcadores, como o LibreTranslate faz com identificadores.
    const translator: MachineTranslator = {
      name: 'libretranslate',
      external: false,
      async translate(texts) {
        calls.push(texts);
        return texts.map((text) => text.replace(/\./g, ',').replace('Registro', 'Record').replace('–', '—'));
      },
      async isAvailable() {
        return true;
      },
    };
    const result = await buildMachineDraft({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      extractedText: 'Registro 000.123.456-7 em 14/03/2006 – nota 8,5',
      glossary: [],
      translator,
      memory: noMemory,
    });
    assert.deepEqual(calls[0], ['Registro [[N0]] em [[N1]] – nota [[N2]]']);
    const block = result.draft.blocks[0];
    assert.equal(block?.kind === 'paragraph' && block.text, 'Record 000.123.456-7 em 03/14/2006 – nota 8.5');
  });

  it('colunas do PDF (espaço largo) viram células traduzidas uma a uma', async () => {
    const { translator, calls } = fakeTranslator();
    const result = await buildMachineDraft({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      extractedText: 'RG  SEXO\n12.345.678-9 SSP/SP  Feminino',
      glossary: [],
      translator,
      memory: noMemory,
    });
    // O RG com o órgão emissor é código: fica como no original e não vai ao provedor (ADR-013).
    // Texto em maiúsculas vai em minúsculas (o provedor erra menos) e volta em maiúsculas; siglas curtas vão como estão.
    assert.deepEqual(calls[0], ['RG', 'Sexo', 'Feminino']);
    const table = result.draft.blocks[0];
    assert.equal(table?.kind, 'table');
    if (table?.kind === 'table') assert.equal(table.rows[1]!.cells[0]!.text, '12.345.678-9 SSP/SP');
  });

  it('memória de tradução vem antes do provedor e não gasta cota', async () => {
    const { translator, calls } = fakeTranslator();
    const memory = async (segments: string[]) =>
      new Map(segments.filter((segment) => segment === 'Resultado final').map((segment) => [segment, 'Final result']));
    const result = await buildMachineDraft({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      extractedText: 'Resultado final\nAprovada',
      glossary: [],
      translator,
      memory,
    });
    assert.deepEqual(calls, [['Aprovada']]);
    const first = result.draft.blocks[0];
    assert.equal(first?.kind === 'paragraph' && `${first.text}|${first.origin}`, 'Final result|memory');
    assert.equal(result.stats.fromMemory, 1);
  });

  it('sem provedor, o rascunho mantém a estrutura do original com o texto preparado', async () => {
    const layout = await analyzePdfLayout(new Uint8Array(await readFile(fixture('original.pdf'))));
    const result = await buildMachineDraft({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      layout,
      glossary: [],
      translator: null,
      memory: noMemory,
    });
    const kinds = result.draft.blocks.map((block) => block.kind);
    assert.equal(kinds.filter((kind) => kind === 'table').length, 3);
    assert.equal(kinds.filter((kind) => kind === 'signature').length, 2);
    assert.equal(kinds[0], 'translator_note');
    assert.equal(result.draft.sourceTitle, 'HISTÓRICO ESCOLAR');
    // Sem tradução, o tipo fica para o revisor; datas já vêm convertidas.
    assert.equal(result.draft.documentType, '');
    assert.match(JSON.stringify(result.draft), /December 15, 2023/);
    assert.ok(result.draft.blocks.every((block) => block.origin === 'rules'));
    // Rascunho sem tradução não passa nas checagens: aprovar exigiria justificativa.
    assert.ok(checkDraft(result.draft, null).some((issue) => issue.code === 'untranslated' && issue.severity === 'error'));
  });

  it('planilha técnica: só cabeçalhos e frases vão ao provedor; códigos ficam e medidas trocam o decimal (ADR-013)', async () => {
    const { translator, calls } = fakeTranslator();
    const layout = await analyzePdfLayout(
      new Uint8Array(await readFile(new URL('../../../fixtures/planilha-tecnica/planilha-ficticia.pdf', import.meta.url))),
    );
    const result = await buildMachineDraft({
      sourceLanguage: 'en',
      targetLanguage: 'pt',
      layout,
      glossary: [],
      translator,
      memory: noMemory,
    });
    const sent = calls.flat();
    // Nenhum código, marca ou sigla da planilha vai ao provedor.
    assert.ok(!sent.some((text) => /CMX16|ACMEMEM|CORVO|Brava|Elmo|^DS$|^SS$|N\/A/.test(text)), JSON.stringify(sent));
    assert.ok(sent.includes('Vendors') && sent.includes('Heat-Sink Package'));
    // "No." é abreviação de número: vai protegido e volta "nº".
    assert.ok(sent.includes('Part [[S0]]'));
    const table = result.draft.blocks.find((block) => block.kind === 'table');
    assert.equal(table?.kind, 'table');
    if (table?.kind === 'table') {
      assert.equal(table.rows[0]!.cells[1]!.text, 'EN:Part nº');
      const corvo = table.rows.find((row) => row.cells[0]!.text === 'CORVO')!;
      assert.deepEqual(
        corvo.cells.map((cell) => cell.text),
        ['CORVO', 'CMX16GX3M2A1333C9(Ver7.21)', '8GB', 'DS', 'N/A', 'N/A', '9-9-9-24', '1,50V', '•', '•'],
      );
    }
    // Uma planilha quase toda de códigos não é "texto não traduzido".
    assert.ok(!checkDraft(result.draft, null).some((issue) => issue.code === 'untranslated'));
  });

  it('reconhece códigos sem confundir com texto em caixa alta', () => {
    for (const code of ['AD3U1333C2G9', 'A-DATA', 'N/A', '9-9-9-24-33', '1.5V', '4GB(2 x 2GB)', '12.345.678-9 SSP/SP', 'G.SKILL'])
      assert.equal(isCodeLike(code), true, code);
    for (const text of ['HISTÓRICO ESCOLAR', 'CORSAIR', 'Vendors', 'Heat-Sink Package', 'Part No.', 'RG'])
      assert.equal(isCodeLike(text), false, text);
  });

  it('pares para a memória saem dos blocos e células com original conhecido', () => {
    const pairs = memoryPairs({
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      documentType: 'X',
      sourceTitle: 'Y',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Final** result',
          align: 'left',
          bold: false,
          size: 'normal',
          sourceText: 'Resultado   final',
          origin: 'human',
        },
        {
          kind: 'table',
          columns: [1],
          rows: [
            { style: 'normal', cells: [{ text: 'Passed', sourceText: 'Aprovada', colSpan: 1, rowSpan: 1, bold: false, align: 'left' }] },
          ],
          sourceText: null,
          origin: 'machine',
        },
        { kind: 'paragraph', text: '8.5', align: 'left', bold: false, size: 'normal', sourceText: '8,5', origin: 'rules' },
        {
          kind: 'translator_note',
          text: 'Stamp reading: “CONFERE COM O ORIGINAL” [TRUE COPY].',
          sourceText: 'CONFERE COM O ORIGINAL',
          origin: 'human',
        },
        { kind: 'translator_note', text: 'Footer: “Valid only with seal”', sourceText: 'Válido somente com selo', origin: 'machine' },
      ],
    });
    assert.deepEqual(
      [...pairs],
      [
        ['Resultado final', '**Final** result'],
        ['Aprovada', 'Passed'],
        ['CONFERE COM O ORIGINAL', 'TRUE COPY'],
        ['Válido somente com selo', 'Valid only with seal'],
      ],
    );
    assert.equal(memoryKey('  a \n b '), 'a b');
  });
});

describe('LibreTranslate real (pulado se o serviço local não estiver no ar)', async () => {
  const url = process.env.LIBRETRANSLATE_TEST_URL ?? 'http://127.0.0.1:15050';
  const translator = createLibreTranslate(url);
  const available = await translator.isAvailable();

  it(
    'traduz o histórico fictício preservando números e datas convertidas',
    { skip: !available && 'LibreTranslate local indisponível' },
    async () => {
      const extraction = await extractPdfText(new Uint8Array(await readFile(fixture('original.pdf'))));
      const result = await buildMachineDraft({
        sourceLanguage: 'pt',
        targetLanguage: 'en',
        extractedText: extraction.text,
        glossary: [],
        translator,
        memory: noMemory,
      });
      const text = JSON.stringify(result.draft);
      assert.match(text, /School|SCHOOL/);
      assert.match(text, /03\/14\/2006/);
      assert.ok(result.stats.translated > 20);
      const numberErrors = checkDraft(result.draft, extraction.text).filter((issue) => issue.code === 'number_missing');
      assert.deepEqual(numberErrors, []);
    },
  );
});

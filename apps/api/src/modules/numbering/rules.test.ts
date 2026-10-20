import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkEntry, pageCharge, parseStockCsv, PRESETS, type CheckState } from './rules.js';

const base: CheckState = {
  actorId: 'u1',
  actorIsManager: false,
  issued: 0,
  hasStock: false,
  stock: null,
  duplicates: 0,
  book: null,
  subscriptionPaid: 0,
  zeroProtocolAuthorized: false,
};
const codes = (result: ReturnType<typeof checkEntry>, severity = 'error') =>
  result.anomalies.filter((anomaly) => anomaly.severity === severity).map((anomaly) => anomaly.code);
const stock = (over: Partial<NonNullable<CheckState['stock']>> = {}): NonNullable<CheckState['stock']> => ({
  id: 's1',
  number: '100',
  book: null,
  free: false,
  status: 'available',
  reservedFor: null,
  maxUses: 1,
  uses: 0,
  usedInSameProtocol: false,
  ...over,
});

describe('regras de numeração por tradutor (ADR-014)', () => {
  const walter = PRESETS.walter!;
  it('Walter: sigla + ano + número, valor do protocolo e da assinatura', () => {
    const ok = checkEntry(walter.scheme, walter.config, { number: 'NB-2026-1111', protocolValue: 80, translatorFee: 50 }, base);
    assert.deepEqual(codes(ok), []);
    assert.deepEqual([ok.computed.protocolValue, ok.computed.translatorFee, ok.computed.free], [80, 50, false]);
    assert.deepEqual(codes(checkEntry(walter.scheme, walter.config, { number: '1111', protocolValue: 80, translatorFee: 50 }, base)), [
      'pattern',
    ]);
    assert.deepEqual(
      codes(
        checkEntry(
          walter.scheme,
          walter.config,
          { number: 'NB-2026-1111', protocolValue: 80, translatorFee: 50 },
          { ...base, duplicates: 1 },
        ),
      ),
      ['duplicate'],
    );
    // Assinatura gratuita por escolha: só o protocolo é cobrado.
    const free = checkEntry(walter.scheme, walter.config, { number: 'NB-2026-1112', protocolValue: 80, free: true }, base);
    assert.deepEqual([codes(free), free.computed.translatorFee], [[], 0]);
  });

  it('Walter: protocolo zerado só com autorização de Supervisor ou Diretor', () => {
    const input = { number: 'NB-2026-1113', protocolValue: 0, translatorFee: 50 };
    assert.deepEqual(codes(checkEntry(walter.scheme, walter.config, input, base)), ['zero_protocol']);
    assert.deepEqual(codes(checkEntry(walter.scheme, walter.config, input, { ...base, zeroProtocolAuthorized: true })), []);
    assert.deepEqual(codes(checkEntry(walter.scheme, walter.config, input, { ...base, actorIsManager: true })), []);
  });

  it('Walter: ao somar R$ 4.000,00 de assinaturas, a assinatura fica gratuita sozinha; sem limite de números', () => {
    const result = checkEntry(
      walter.scheme,
      walter.config,
      { number: 'NB-2026-2000', protocolValue: 80, translatorFee: 50 },
      {
        ...base,
        subscriptionPaid: 4000,
        issued: 999_999,
      },
    );
    assert.deepEqual([codes(result), result.computed.free, result.computed.translatorFee], [[], true, 0]);
    assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'free_mismatch' && anomaly.severity === 'warning'));
  });

  const patricia = PRESETS.patricia!;
  const book = { id: 'b1', book: '12', nextNumber: 501, nextSheet: 398, advanced: false };
  it('Patricia: número, livro e folha automáticos, pelas páginas do documento', () => {
    const result = checkEntry(patricia.scheme, patricia.config, { pages: 2 }, { ...base, book });
    assert.deepEqual(codes(result), []);
    assert.deepEqual(
      [result.computed.number, result.computed.book, result.computed.sheetStart, result.computed.sheetEnd],
      ['501', '12', 398, 399],
    );
    assert.deepEqual(codes(checkEntry(patricia.scheme, patricia.config, {}, { ...base, book })), ['missing']);
    assert.deepEqual(codes(checkEntry(patricia.scheme, patricia.config, { pages: 1, number: '777' }, { ...base, book })), [
      'out_of_sequence',
    ]);
  });

  it('Patricia: documento que começa antes da folha 400 pode passar dela; sem próximo livro, a numeração trava', () => {
    const over = checkEntry(patricia.scheme, patricia.config, { pages: 10 }, { ...base, book });
    assert.deepEqual([codes(over), over.computed.sheetEnd], [[], 407]);
    assert.ok(over.anomalies.some((anomaly) => anomaly.severity === 'warning' && /livro seguinte/.test(anomaly.message)));
    assert.deepEqual(codes(checkEntry(patricia.scheme, patricia.config, { pages: 1 }, { ...base, book: null })), ['book_locked']);
    const next = checkEntry(
      patricia.scheme,
      patricia.config,
      { pages: 1 },
      { ...base, book: { ...book, id: 'b2', book: '13', nextNumber: 900, nextSheet: 1, advanced: true } },
    );
    assert.deepEqual([codes(next), next.computed.book, next.computed.number], [[], '13', '900']);
  });

  const carla = PRESETS.carla!;
  it('Carla: número da planilha até 2 vezes, nunca no mesmo protocolo; lote gratuito', () => {
    const input = { number: '100', protocol: 'P-1', language: 'Francês' };
    assert.deepEqual(
      codes(checkEntry(carla.scheme, carla.config, input, { ...base, hasStock: true, stock: stock({ maxUses: 2, uses: 1 }) })),
      [],
    );
    assert.deepEqual(
      codes(checkEntry(carla.scheme, carla.config, input, { ...base, hasStock: true, stock: stock({ maxUses: 2, uses: 2 }) })),
      ['uses_exhausted'],
    );
    assert.deepEqual(
      codes(
        checkEntry(carla.scheme, carla.config, input, {
          ...base,
          hasStock: true,
          stock: stock({ maxUses: 2, uses: 1, usedInSameProtocol: true }),
        }),
      ),
      ['same_protocol'],
    );
    assert.deepEqual(
      codes(checkEntry(carla.scheme, carla.config, { ...input, protocol: '' }, { ...base, hasStock: true, stock: stock({ maxUses: 2 }) })),
      ['missing'],
    );
    assert.deepEqual(
      codes(checkEntry(carla.scheme, carla.config, { ...input, free: true }, { ...base, hasStock: true, stock: stock({ maxUses: 2 }) })),
      ['free_mismatch'],
    );
    assert.deepEqual(codes(checkEntry(carla.scheme, carla.config, input, { ...base, hasStock: true, stock: null })), ['not_in_stock']);
  });

  it('estoque: bloqueado, reservado para outra pessoa e limite do Supervisor', () => {
    const bruno = PRESETS.bruno!;
    assert.deepEqual(
      codes(checkEntry(bruno.scheme, bruno.config, { number: '100' }, { ...base, hasStock: true, stock: stock({ status: 'blocked' }) })),
      ['blocked'],
    );
    const reserved = stock({ status: 'reserved', reservedFor: 'u2' });
    assert.deepEqual(codes(checkEntry(bruno.scheme, bruno.config, { number: '100' }, { ...base, hasStock: true, stock: reserved })), [
      'reserved',
    ]);
    assert.deepEqual(
      codes(checkEntry(bruno.scheme, bruno.config, { number: '100' }, { ...base, actorId: 'u2', hasStock: true, stock: reserved })),
      [],
    );
    assert.deepEqual(
      codes(
        checkEntry(
          bruno.scheme,
          { ...bruno.config, limit: 10 },
          { number: '100' },
          { ...base, issued: 10, hasStock: true, stock: stock() },
        ),
      ),
      ['limit_reached'],
    );
  });

  it('Antonio: digital ou impresso obrigatório; Vivian: até 3 páginas grátis, R$ 2,00 por página extra', () => {
    const antonio = PRESETS.antonio!;
    assert.deepEqual(codes(checkEntry(antonio.scheme, antonio.config, { number: '100' }, { ...base, hasStock: true, stock: stock() })), [
      'missing',
    ]);
    assert.deepEqual(
      codes(checkEntry(antonio.scheme, antonio.config, { number: '100', medium: 'impresso' }, { ...base, hasStock: true, stock: stock() })),
      [],
    );
    const vivian = PRESETS.vivian!;
    const result = checkEntry(
      vivian.scheme,
      vivian.config,
      { number: 'G-2026-15555', pages: 7 },
      { ...base, hasStock: true, stock: stock({ number: 'G-2026-15555', book: 'G-2026' }) },
    );
    assert.deepEqual([codes(result), result.computed.pageCharge, result.computed.book], [[], 8, 'G-2026']);
    assert.equal(pageCharge(3, 3, 2), 0);
  });

  it('planilha CSV do Excel: separador, cabeçalho, idioma, gratuito e repetidos', () => {
    const parsed = parseStockCsv('﻿Número;Livro;Idioma;Gratuito\n100;7;Francês;não\n101;7;Italiano;sim\n100;7;Francês;não\n;7;;\n');
    assert.deepEqual(parsed.rows, [
      { number: '100', book: '7', language: 'Francês', free: false },
      { number: '101', book: '7', language: 'Italiano', free: true },
    ]);
    assert.equal(parsed.problems.length, 2);
    const plain = parseStockCsv('G-2026-15555,G-2026\nG-2026-15556,G-2026', { free: true, language: 'Inglês' });
    assert.deepEqual(plain.rows[1], { number: 'G-2026-15556', book: 'G-2026', language: 'Inglês', free: true });
  });
});

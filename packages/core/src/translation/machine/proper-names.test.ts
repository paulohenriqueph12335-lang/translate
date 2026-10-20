import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardForTranslation, isAllCaps, prepareSegment, protectSegment } from './machine-draft.js';
import { visualLabel } from './notes.js';
import { personNames, placeNames, webAddresses } from './proper-names.js';

describe('nomes próprios e marcadores protegidos', () => {
  it('acha pessoas, cidades e endereços', () => {
    assert.deepEqual(personNames('ROBERTO TEIXEIRA NUNES e LUCIANA ALVES TEIXEIRA'), ['ROBERTO TEIXEIRA NUNES', 'LUCIANA ALVES TEIXEIRA']);
    assert.deepEqual(personNames('assinado por Ana Paula Rego da Silva, oficial'), ['Ana Paula Rego da Silva']);
    assert.deepEqual(personNames('Hospital Municipal Santa Clara'), []);
    assert.deepEqual(personNames('DATA DE NASCIMENTO'), []);
    assert.deepEqual(placeNames('Hospital Regional, Serra Clara – SC; natural de Porto Aurora/PA'), ['Serra Clara', 'Porto Aurora']);
    assert.deepEqual(placeNames('SSP/EF'), []);
    assert.deepEqual(placeNames('Cartório do 1º Ofício de Registro Civil de Vila Esperança – EF'), ['Vila Esperança']);
    assert.deepEqual(placeNames('natural de São José dos Campos/SP'), ['São José dos Campos']);
    assert.deepEqual(webAddresses('Verifique em: verificacao-ficticia.exemplo/apostila – código X'), ['verificacao-ficticia.exemplo/apostila']);
  });

  it('protege nomes, colchetes e ordinais; maiúsculas vão em minúsculas e voltam', () => {
    const guarded = protectSegment('[CARIMBO] Oficial ANA PAULA REGO, 1ª via', [], ['ANA PAULA REGO']);
    assert.doesNotMatch(guarded.text, /CARIMBO|ANA PAULA|1ª/);
    assert.equal(guarded.restore(guarded.text), '[CARIMBO] Oficial ANA PAULA REGO, 1ª via');

    const company = protectSegment('BANCO FICTÍCIO S.A.', []);
    assert.doesNotMatch(company.text, /S\.A\./);
    assert.equal(company.restore(company.text), 'BANCO FICTÍCIO S.A.');

    const caps = guardForTranslation('REPÚBLICA FICTÍCIA DO BRASIL', 'fr', []);
    assert.equal(caps.text, 'República fictícia do brasil');
    assert.equal(caps.restore('République fictive du Brésil'), 'RÉPUBLIQUE FICTIVE DU BRÉSIL');
    assert.equal(isAllCaps('Nome'), false);
    assert.equal(prepareSegment('Cartório do 1º Ofício, 2ª via', 'pt', 'fr'), 'Cartório do 1er Ofício, 2e via');
  });

  it('rótulo de elemento visual vira marcador no idioma de destino', () => {
    assert.equal(visualLabel('BRASÃO', 'en'), '[Coat of Arms]');
    assert.equal(visualLabel('QR CODE', 'fr'), '[Code QR]');
    assert.equal(visualLabel('SÍMBOLO', 'es'), '[Logotipo]');
    assert.equal(visualLabel('Brasão da República Federativa', 'en'), null);
  });
});

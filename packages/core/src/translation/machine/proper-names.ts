/**
 * Nomes próprios ficam como no original (regra das skills): pessoas, cidades, endereços eletrônicos. O provedor de
 * tradução não sabe disso e traduz "ANA PAULA REGO" como "AGE PAUL AGE" e "Serra Clara" como "Sierra Clara".
 * Aqui se acham esses trechos para que sigam protegidos, como os números.
 */

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();

/** Prenomes comuns no Brasil (sem acento, em maiúsculas). Um nome de pessoa começa por um deles. */
const FIRST_NAMES = new Set(
  (
    'ADRIANA ADRIANO AFONSO ALAN ALBERTO ALESSANDRA ALEX ALEXANDRE ALICE ALINE AMANDA ANA ANDERSON ANDRE ANDREA ANDREIA ANGELA ' +
    'ANTONIA ANTONIO ARTHUR AUGUSTO AURORA BARBARA BEATRIZ BENEDITO BENEDITA BERNARDO BRUNA BRUNO CAIO CAMILA CARLA CARLOS ' +
    'CAROLINA CASSIO CATARINA CECILIA CELIA CESAR CICERO CLARA CLAUDIA CLAUDIO CRISTIANE CRISTIANO CRISTINA DANIEL DANIELA ' +
    'DANIELE DAVI DAVID DEBORA DENISE DIANA DIEGO DIOGO DOUGLAS EDSON EDUARDO ELAINE ELIANE ELISA ELISABETE EMANUEL EMANUELLE ' +
    'EMILY ENZO ERICA ERICK FABIANA FABIO FABRICIO FATIMA FELIPE FERNANDA FERNANDO FLAVIA FLAVIO FRANCISCA FRANCISCO GABRIEL ' +
    'GABRIELA GABRIELLE GERALDO GILBERTO GIOVANA GIOVANNA GISELE GUILHERME GUSTAVO HEITOR HELENA HELIO HENRIQUE HUGO IARA IGOR ' +
    'IRENE ISABEL ISABELA ISABELLA ISADORA IVAN IVONE JACKSON JAQUELINE JEFERSON JEFFERSON JESSICA JOANA JOAO JOAQUIM JONAS ' +
    'JORGE JOSE JOSEFA JOSIANE JULIA JULIANA JULIANO JULIO KAREN KATIA LARA LARISSA LAURA LEANDRO LEONARDO LETICIA LIDIA ' +
    'LILIAN LIVIA LORENA LORENZO LUANA LUCAS LUCIA LUCIANA LUCIANO LUIS LUISA LUIZ LUIZA MANUEL MANUELA MARCELA MARCELO ' +
    'MARCIA MARCIO MARCO MARCOS MARCIO MARIA MARIANA MARINA MARIO MARLENE MARTA MATEUS MATHEUS MAURICIO MELISSA MICHELE ' +
    'MIGUEL MILENA MIRIAM MONICA MURILO NATALIA NATHALIA NELSON NICOLAS NICOLE OLIVIA OSCAR OTAVIO PABLO PAMELA PATRICIA ' +
    'PAULA PAULO PEDRO PRISCILA RAFAEL RAFAELA RAIMUNDO RAIMUNDA RAQUEL REGINA REGINALDO RENAN RENATA RENATO RICARDO RITA ' +
    'ROBERTA ROBERTO RODRIGO ROGERIO ROSA ROSANA ROSANGELA SABRINA SAMUEL SANDRA SARA SARAH SEBASTIAO SERGIO SILVANA SILVIA ' +
    'SIMONE SOFIA SONIA SOPHIA SUELI TAINA TATIANA TEREZA TERESA THAIS THIAGO TIAGO VALERIA VANESSA VERA VICTOR VINICIUS VITOR ' +
    'VITORIA VIVIAN VIVIANE WAGNER WALTER WANDERLEY WELLINGTON WESLEY WILLIAM YASMIN'
  ).split(' '),
);

/** Ligações dentro de nomes ("da", "dos"); "e" separa duas pessoas. */
const CONNECTORS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'DI', 'DEL', 'VAN', 'VON']);

const WORD = /[\p{Lu}][\p{L}'’-]*/u;
const isCapitalized = (word: string) => WORD.test(word) && word[0] === word[0]!.toUpperCase();

/** Nomes de pessoas no trecho: prenome conhecido seguido de pelo menos mais um nome (sobrenomes, ligações). */
export function personNames(text: string): string[] {
  const names: string[] = [];
  const tokens = [...text.matchAll(/[\p{L}'’-]+/gu)];
  for (let index = 0; index < tokens.length; index += 1) {
    const first = tokens[index]![0];
    if (!isCapitalized(first) || !FIRST_NAMES.has(fold(first))) continue;
    // Prenome em maiúsculas pede sobrenomes em maiúsculas; em "Ana Paula", inicial maiúscula basta.
    const upper = first === first.toUpperCase();
    let end = index;
    for (let next = index + 1; next < tokens.length; next += 1) {
      const between = text.slice(tokens[next - 1]!.index! + tokens[next - 1]![0].length, tokens[next]!.index!);
      if (!/^\s+$/.test(between)) break;
      const word = tokens[next]![0];
      const connector = CONNECTORS.has(fold(word)) && (upper ? word === word.toUpperCase() : word === word.toLowerCase());
      const part = isCapitalized(word) && (!upper || word === word.toUpperCase()) && !CONNECTORS.has(fold(word));
      if (part) end = next;
      else if (!connector) break;
    }
    if (end > index) {
      names.push(text.slice(tokens[index]!.index!, tokens[end]!.index! + tokens[end]![0].length));
      index = end;
    }
  }
  return names;
}

/** Palavras de órgão ou lugar genérico: o que vem antes delas não é parte do nome da cidade. */
const INSTITUTION =
  /\b(registro|civil|cart[óo]rio|of[íi]cio|comarca|munic[íi]pio|prefeitura|secretaria|tribunal|distrito|bairro|hospital|maternidade|escola|col[ée]gio|universidade|instituto|conselho|departamento|serventia|tabelionato|junta|delegacia|vara|f[óo]rum)\b/iu;

/**
 * Cidades: o nome antes da sigla do estado ("Vila Esperança – EF", "Porto Aurora/PA", "Serra Clara, SC"). Valem para o
 * documento inteiro, porque a mesma cidade aparece depois sem a sigla ("Vila Esperança, 10 de dezembro").
 */
export function placeNames(text: string): string[] {
  const places: string[] = [];
  const pattern =
    /((?:[\p{Lu}][\p{L}'’-]+)(?:\s+(?:d[aeo]s?\s+)?[\p{Lu}][\p{L}'’-]+){0,3})\s*(?:[–—-]\s*|\/|,\s*)([A-Z]{2})(?![\p{L}])/gu;
  for (const match of text.matchAll(pattern)) {
    let name = match[1]!.trim();
    // "Registro Civil de Vila Esperança – EF": a cidade é o que vem depois do órgão.
    const parts = name.split(/\s+(?:d[aeo]s?)\s+/);
    for (let index = parts.length - 1; index > 0; index -= 1) {
      if (INSTITUTION.test(parts.slice(0, index).join(' '))) {
        name = name.slice(name.indexOf(parts[index]!, name.length - parts.slice(index).join(' ').length - 1));
        break;
      }
    }
    // "SSP/EF" ou "CPF – SP" são siglas, não cidades.
    if (name.length < 4 || !/\p{Ll}/u.test(name) && name.split(/\s+/).length < 2) continue;
    places.push(name);
  }
  return places;
}

/** Endereços eletrônicos e de sites ("verificacao-ficticia.exemplo/apostila", "nome@exemplo.test"). */
export function webAddresses(text: string): string[] {
  return [...text.matchAll(/(?:https?:\/\/)?[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[\w./%-]*)?/giu)].map(
    (match) => match[0],
  );
}

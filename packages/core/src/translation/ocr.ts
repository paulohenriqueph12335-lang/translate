import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Language } from './draft.js';

/**
 * OCR local e gratuito (Tesseract) para imagens e PDFs digitalizados (ADR-018): o documento não sai da
 * infraestrutura. O texto reconhecido segue o mesmo caminho do texto extraído (tradução, revisão automática, prévia).
 * As linhas mantêm as colunas do original: palavras separadas por espaço largo viram células ("a  b").
 */

const run = promisify(execFile);
const TESSERACT_LANG: Record<Language, string> = { pt: 'por', en: 'eng', fr: 'fra', it: 'ita', es: 'spa' };
/** Páginas lidas de um PDF digitalizado; documentos longos ficam para a pessoa conferir. */
const MAX_PAGES = 20;

export interface OcrResult {
  text: string;
  pages: number;
  /** Confiança média das palavras (0–100). */
  confidence: number;
}

let available: Promise<string[] | null> | null = null;

/** Idiomas instalados no Tesseract; `null` quando ele não está instalado (o sistema segue sem OCR). */
export function ocrLanguages() {
  available ??= run('tesseract', ['--list-langs'], { timeout: 10_000 })
    .then(({ stdout, stderr }) =>
      `${stdout}\n${stderr}`
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[a-z_]{3,}$/.test(line) && line !== 'osd'),
    )
    .catch(() => null);
  return available;
}

interface Word {
  block: number;
  paragraph: number;
  line: number;
  left: number;
  width: number;
  height: number;
  confidence: number;
  text: string;
}

/** Linhas de uma página a partir do TSV do Tesseract, com espaço largo entre colunas distantes. */
export function linesFromTsv(tsv: string) {
  const words: Word[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    const cells = row.split('\t');
    if (cells.length < 12 || cells[0] !== '5') continue;
    const text = cells[11]!.trim();
    if (!text) continue;
    words.push({
      block: Number(cells[2]),
      paragraph: Number(cells[3]),
      line: Number(cells[4]),
      left: Number(cells[6]),
      width: Number(cells[8]),
      height: Number(cells[9]),
      confidence: Number(cells[10]),
      text,
    });
  }
  const lines = new Map<string, Word[]>();
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    lines.set(key, [...(lines.get(key) ?? []), word]);
  }
  const text = [...lines.values()]
    .map((line) =>
      line
        .sort((a, b) => a.left - b.left)
        .map((word, index) => {
          const previous = line[index - 1];
          if (!previous) return word.text;
          // Distância maior que ~3 caracteres: outra coluna (rótulo e valor, células de tabela).
          const gap = word.left - (previous.left + previous.width);
          return `${gap > previous.height * 1.6 ? '  ' : ' '}${word.text}`;
        })
        .join(''),
    )
    .join('\n');
  const confident = words.filter((word) => word.confidence >= 0);
  return { text, confidence: confident.length ? confident.reduce((sum, word) => sum + word.confidence, 0) / confident.length : 0 };
}

async function recognize(image: string, languages: string) {
  // psm 3: página inteira com segmentação automática; o TSV traz posição e confiança de cada palavra.
  const { stdout } = await run('tesseract', [image, 'stdout', '-l', languages, '--psm', '3', 'tsv'], {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return linesFromTsv(stdout);
}

/**
 * Texto de uma imagem (PNG/JPEG) ou de um PDF sem camada de texto. `null` quando não há Tesseract instalado.
 * O idioma do original vai primeiro; o inglês ajuda com siglas e trechos mistos.
 */
export async function ocrDocument(data: Uint8Array, format: string, source: Language): Promise<OcrResult | null> {
  const installed = await ocrLanguages();
  if (!installed) return null;
  const wanted = [TESSERACT_LANG[source], 'eng'].filter((code, index, all) => installed.includes(code) && all.indexOf(code) === index);
  if (!wanted.length) return null;
  const languages = wanted.join('+');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    const images: string[] = [];
    if (format === 'pdf') {
      const pdf = path.join(dir, 'original.pdf');
      await writeFile(pdf, data);
      // 300 dpi em tons de cinza: o padrão recomendado para OCR de documentos.
      await run('pdftoppm', ['-r', '300', '-gray', '-png', '-l', String(MAX_PAGES), pdf, path.join(dir, 'pagina')], {
        timeout: 180_000,
      });
      images.push(
        ...(await readdir(dir))
          .filter((name) => name.startsWith('pagina'))
          .sort()
          .map((name) => path.join(dir, name)),
      );
    } else {
      const image = path.join(dir, format === 'png' ? 'original.png' : 'original.jpg');
      await writeFile(image, data);
      images.push(image);
    }
    const pages: Array<{ text: string; confidence: number }> = [];
    for (const image of images) pages.push(await recognize(image, languages));
    const text = pages.map((page) => page.text).join('\n\n');
    const confidence = pages.length ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length : 0;
    return { text, pages: images.length, confidence: Math.round(confidence) };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Para testes: lê um arquivo e devolve o texto reconhecido. */
export async function ocrFile(file: string, source: Language) {
  const data = new Uint8Array(await readFile(file));
  return ocrDocument(data, path.extname(file).slice(1).toLowerCase() === 'pdf' ? 'pdf' : 'png', source);
}

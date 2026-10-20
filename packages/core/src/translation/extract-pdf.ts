import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfExtraction {
  pages: number;
  /** Texto horizontal reconstruído em linhas, de cima para baixo e da esquerda para a direita. */
  text: string;
  /** Texto inclinado (marcas d'água, carimbos girados), separado para não embaralhar as linhas. */
  rotatedText: string[];
  /** `false` quando o PDF não tem camada de texto útil (provavelmente digitalizado; exige OCR). */
  hasTextLayer: boolean;
}

interface Item {
  str: string;
  x: number;
  y: number;
  height: number;
}

/**
 * Extrai o texto de um PDF digital com posições, sem executar scripts do arquivo (ADR-007).
 * Não interpreta tabelas: serve às checagens determinísticas e ao rascunho manual.
 */
export async function extractPdfText(data: Uint8Array): Promise<PdfExtraction> {
  // Sem scripts: o pdf.js 6 não executa JavaScript do arquivo; fontes não são carregadas no processo.
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  const lines: string[] = [];
  const rotated: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue;
        const [a, b, , , x, y] = raw.transform as number[];
        if (Math.abs(b ?? 0) > 0.01 || (a ?? 0) < 0) {
          rotated.push(raw.str.trim());
          continue;
        }
        items.push({ str: raw.str, x: x ?? 0, y: y ?? 0, height: raw.height });
      }
      // Agrupa por linha com tolerância de metade da altura do texto.
      items.sort((left, right) => right.y - left.y || left.x - right.x);
      let current: Item[] = [];
      const flush = () => {
        if (!current.length) return;
        current.sort((left, right) => left.x - right.x);
        lines.push(current.map((item) => item.str.trim()).join('  '));
        current = [];
      };
      for (const item of items) {
        const anchor = current[0];
        if (anchor && Math.abs(anchor.y - item.y) > Math.max(2, anchor.height / 2)) flush();
        current.push(item);
      }
      flush();
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const text = lines.join('\n');
  return { pages: pdf.numPages, text, rotatedText: mergeRotated(rotated), hasTextLayer: text.replace(/\s/g, '').length > 40 };
}

/** Marcas d'água costumam vir letra a letra; junta fragmentos curtos consecutivos. */
function mergeRotated(fragments: string[]) {
  const merged: string[] = [];
  for (const fragment of fragments) {
    const last = merged.at(-1);
    if (last !== undefined && fragment.length <= 2 && last.length < 80) merged[merged.length - 1] = last + fragment;
    else merged.push(fragment);
  }
  return merged;
}

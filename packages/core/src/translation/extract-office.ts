import JSZip from 'jszip';

export interface OfficeExtraction {
  text: string;
  hasTextLayer: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? match;
  });

/** Texto de um parágrafo do Word: runs, tabulações e quebras de linha. */
const wordParagraph = (xml: string) =>
  decode(
    [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((match) => (match[0] === '<w:tab/>' ? '\t' : match[0] === '<w:br/>' ? '\n' : match[1]!))
      .join(''),
  ).trim();

/** Corpo do Word em linhas; cada linha de tabela vira "célula | célula | …". */
function wordBody(xml: string) {
  const lines: string[] = [];
  for (const block of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const chunk = block[0];
    if (chunk.startsWith('<w:tbl>')) {
      for (const row of chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
          [...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
            .map((p) => wordParagraph(p[0]))
            .filter(Boolean)
            .join(' '),
        );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
    } else {
      const text = wordParagraph(chunk);
      if (text) lines.push(text);
    }
  }
  return lines;
}

const partNumber = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/**
 * Texto de DOCX ou PPTX para a tradução (ADR-007). Lê apenas o XML do pacote, sem macros nem objetos incorporados.
 * Cabeçalhos e rodapés do Word vêm marcados, para o tradutor descrevê-los como no original.
 */
export async function extractOfficeText(data: Uint8Array, format: 'docx' | 'pptx'): Promise<OfficeExtraction> {
  const zip = await JSZip.loadAsync(data);
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('');
  const lines: string[] = [];

  if (format === 'docx') {
    const names = Object.keys(zip.files);
    for (const name of names.filter((item) => /^word\/header\d*\.xml$/.test(item)).sort((a, b) => partNumber(a) - partNumber(b))) {
      const header = wordBody(await read(name));
      if (header.length) lines.push(`[Cabeçalho] ${header.join(' / ')}`);
    }
    lines.push(...wordBody(await read('word/document.xml')));
    for (const name of names.filter((item) => /^word\/footer\d*\.xml$/.test(item)).sort((a, b) => partNumber(a) - partNumber(b))) {
      const footer = wordBody(await read(name));
      if (footer.length) lines.push(`[Rodapé] ${footer.join(' / ')}`);
    }
  } else {
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => partNumber(a) - partNumber(b));
    for (const name of slides) {
      lines.push(`[Slide ${partNumber(name)}]`);
      for (const paragraph of (await read(name)).matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
        const text = decode([...paragraph[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]!).join('')).trim();
        if (text) lines.push(text);
      }
    }
  }

  const text = lines.join('\n');
  return { text, hasTextLayer: text.replace(/\[(Slide \d+|Cabeçalho|Rodapé)\]/g, '').replace(/\s/g, '').length > 0 };
}

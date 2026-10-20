import { open } from 'node:fs/promises';

/** Formatos aceitos na Fase 2 (ADR-006). A extensão declarada precisa corresponder ao formato detectado. */
export const DETECTED_FORMATS = ['docx', 'pdf', 'jpeg', 'png', 'pptx'] as const;
export type DetectedFormat = (typeof DETECTED_FORMATS)[number];

export const ALLOWED_EXTENSIONS = ['docx', 'pdf', 'jpg', 'jpeg', 'png', 'pptx'] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const formatForExtension = (extension: AllowedExtension): DetectedFormat => (extension === 'jpg' ? 'jpeg' : extension);

export const CONTENT_TYPES: Record<DetectedFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Extensão em minúsculas, se for uma das aceitas. */
export function extensionOf(name: string): AllowedExtension | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  const extension = match?.[1]?.toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extension ?? '') ? (extension as AllowedExtension) : null;
}

export type DetectionResult =
  | { ok: true; format: DetectedFormat }
  | { ok: false; reason: 'unknown_format' | 'protected_or_legacy' | 'invalid_archive' };

const startsWith = (buffer: Buffer, signature: number[]) => signature.every((byte, index) => buffer[index] === byte);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // Office protegido por senha ou .doc/.ppt legados

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_CENTRAL_DIRECTORY = 8 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

/** Detecta o formato real pela assinatura e, para ZIP, pelos nomes do diretório central. Não extrai conteúdo. */
export async function detectFormat(filePath: string): Promise<DetectionResult> {
  const file = await open(filePath, 'r');
  try {
    const { size } = await file.stat();
    const head = Buffer.alloc(8);
    await file.read(head, 0, 8, 0);
    if (startsWith(head, PDF)) return { ok: true, format: 'pdf' };
    if (startsWith(head, PNG)) return { ok: true, format: 'png' };
    if (startsWith(head, JPEG)) return { ok: true, format: 'jpeg' };
    if (startsWith(head, OLE)) return { ok: false, reason: 'protected_or_legacy' };
    if (!startsWith(head, ZIP)) return { ok: false, reason: 'unknown_format' };

    const names = await readZipEntryNames(file, size);
    if (!names) return { ok: false, reason: 'invalid_archive' };
    if (!names.has('[Content_Types].xml')) return { ok: false, reason: 'unknown_format' };
    if (names.has('word/document.xml')) return { ok: true, format: 'docx' };
    if (names.has('ppt/presentation.xml')) return { ok: true, format: 'pptx' };
    return { ok: false, reason: 'unknown_format' };
  } finally {
    await file.close();
  }
}

async function readZipEntryNames(file: Awaited<ReturnType<typeof open>>, size: number): Promise<Set<string> | null> {
  // O registro final (EOCD) fica nos últimos 22 bytes + comentário de até 64 KiB.
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = Buffer.alloc(tailLength);
  await file.read(tail, 0, tailLength, size - tailLength);
  let eocd = -1;
  for (let index = tailLength - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64 e diretórios fora dos limites são recusados.
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null;
  if (entries > MAX_ENTRIES || directorySize > MAX_CENTRAL_DIRECTORY || directoryOffset + directorySize > size) return null;

  const directory = Buffer.alloc(directorySize);
  await file.read(directory, 0, directorySize, directoryOffset);
  const names = new Set<string>();
  let offset = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength;
    if (end > directory.length) return null;
    names.add(directory.toString('utf8', offset + 46, end));
    offset = end + extraLength + commentLength;
  }
  return names;
}

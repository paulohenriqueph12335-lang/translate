/**
 * Cabeçalho `Content-Disposition: attachment` seguro: fallback ASCII sem aspas, barras ou controles,
 * e nome completo em UTF-8 pela forma `filename*` (RFC 6266/5987).
 */
export function contentDisposition(name: string) {
  const ascii =
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\x20-\x7e]|["\\/;]/g, '_')
      .trim() || 'documento';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

import { AppError } from './errors.js';

/**
 * Word → PDF pelo conversor do LibreOffice (Gotenberg) que roda no Compose (ADR-017). O PDF reproduz o Word como o
 * Word imprime; sem conversor configurado, a opção de PDF responde indisponível e o Word continua liberado.
 */
export async function docxToPdf(converterUrl: string | undefined, docx: Buffer, name: string): Promise<Buffer> {
  if (!converterUrl) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Conversão para PDF não configurada (CONVERTER_URL)');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(docx)]), name.endsWith('.docx') ? name : `${name}.docx`);
  let response: Response;
  try {
    response = await fetch(`${converterUrl.replace(/\/$/, '')}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'O conversor de PDF não respondeu; baixe o Word e tente o PDF de novo');
  }
  if (!response.ok) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `O conversor de PDF recusou o arquivo (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export const pdfName = (docxName: string) => docxName.replace(/\.docx$/i, '') + '.pdf';

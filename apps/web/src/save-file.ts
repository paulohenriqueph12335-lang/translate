export interface SaveRequest {
  url: string;
  suggestedName: string;
  mimeType: string;
  extension: '.docx' | '.pdf' | '.zip' | string;
  init?: RequestInit;
  preferNative?: boolean;
}
interface SaveHandle {
  name: string;
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}
interface SaveOptions {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}
export interface SaveEnvironment {
  pickFile?: (options: SaveOptions) => Promise<SaveHandle>;
  fetchFile: (url: string, init: RequestInit) => Promise<Response>;
  downloadBlob: (blob: Blob, name: string) => void;
}
export type SaveResult = { status: 'cancelled' } | { status: 'saved' | 'downloaded'; name: string };

export function attachmentName(disposition: string | null, fallback: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  const quoted = /filename="([^"\r\n]+)"/i.exec(disposition ?? '')?.[1];
  let name = quoted ?? fallback;
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* Retain a valid fallback for malformed headers. */
    }
  }
  return name.replace(/[\\/\u0000-\u001f]/g, '_').trim() || fallback;
}
function browserEnvironment(): SaveEnvironment {
  const browser = window as unknown as { showSaveFilePicker?: (options: SaveOptions) => Promise<SaveHandle> };
  return {
    ...(window.isSecureContext && browser.showSaveFilePicker ? { pickFile: browser.showSaveFilePicker.bind(window) } : {}),
    fetchFile: (url, init) => fetch(url, init),
    downloadBlob: (blob, name) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  };
}
export const canChooseSaveLocation = () => typeof window !== 'undefined' && window.isSecureContext && 'showSaveFilePicker' in window;

/** Invoke from the click handler: the native chooser must run before the network request/user activation expires. */
export async function saveFile(request: SaveRequest, environment: SaveEnvironment = browserEnvironment()): Promise<SaveResult> {
  let handle: SaveHandle | undefined;
  if (environment.pickFile && request.preferNative !== false) {
    try {
      handle = await environment.pickFile({
        suggestedName: request.suggestedName,
        types: [{ description: request.extension.slice(1).toUpperCase(), accept: { [request.mimeType]: [request.extension] } }],
      });
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') return { status: 'cancelled' };
      throw new Error('Não foi possível abrir a escolha de local. Confira a permissão deste navegador ou use o download padrão.');
    }
  }
  const response = await environment.fetchFile(request.url, { credentials: 'same-origin', ...request.init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Não foi possível preparar o arquivo. Tente novamente.');
  }
  const name = attachmentName(response.headers.get('content-disposition'), request.suggestedName);
  if (handle) {
    const writable = await handle.createWritable();
    if (response.body) await response.body.pipeTo(writable);
    else {
      const writer = writable.getWriter();
      try {
        await writer.write(new Uint8Array(await response.arrayBuffer()));
        await writer.close();
      } catch (caught) {
        await writer.abort(caught).catch(() => undefined);
        throw caught;
      }
    }
    return { status: 'saved', name: handle.name };
  }
  environment.downloadBlob(await response.blob(), name);
  return { status: 'downloaded', name };
}

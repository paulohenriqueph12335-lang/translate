import type { Language } from '../draft.js';

/** Provedor de tradução de texto, trecho a trecho (ADR-008). */
export interface MachineTranslator {
  readonly name: MachineProviderName;
  /** `true` quando o texto sai da infraestrutura da organização. */
  readonly external: boolean;
  /** Traduz os trechos na mesma ordem. */
  translate(texts: string[], from: Language, to: Language): Promise<string[]>;
  /** Verificação leve para o sinal de vida do worker. */
  isAvailable(): Promise<boolean>;
}

export type MachineProviderName = 'libretranslate' | 'deepl';
export const MACHINE_PROVIDERS = ['libretranslate', 'deepl', 'none'] as const;
export type MachineProviderSetting = (typeof MACHINE_PROVIDERS)[number];

/** Falha tipada do provedor; `retryable` para indisponibilidade temporária e cota. */
export class MachineTranslationFailed extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;

/** Agrupa trechos em lotes por quantidade e por caracteres. */
function batches(texts: string[], maxItems: number, maxChars: number) {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length && (current.length >= maxItems || size + text.length > maxChars)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) groups.push(current);
  return groups;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new MachineTranslationFailed(`Provedor inacessível (${(error as Error).name})`, true);
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status === 456 || response.status >= 500;
    throw new MachineTranslationFailed(`Provedor respondeu ${response.status}`, retryable);
  }
  return response.json() as Promise<unknown>;
}

/** LibreTranslate (auto-hospedado): `POST /translate` com lista de trechos. */
export function createLibreTranslate(baseUrl: string, apiKey?: string): MachineTranslator {
  const url = baseUrl.replace(/\/+$/, '');
  return {
    name: 'libretranslate',
    external: false,
    async translate(texts, from, to) {
      const results: string[] = [];
      // Lotes pequenos: o LibreTranslate em CPU demora com textos longos e cada pedido tem prazo (TIMEOUT_MS).
      for (const group of batches(texts, 25, 4000)) {
        const data = (await postJson(`${url}/translate`, {
          q: group,
          source: from,
          target: to,
          format: 'text',
          ...(apiKey ? { api_key: apiKey } : {}),
        })) as { translatedText?: string[] | string };
        const translated = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
        if (translated.length !== group.length || translated.some((text) => typeof text !== 'string')) {
          throw new MachineTranslationFailed('Resposta do LibreTranslate incompleta', false);
        }
        results.push(...(translated as string[]));
      }
      return results;
    },
    async isAvailable() {
      try {
        const response = await fetch(`${url}/languages`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return false;
        const languages = (await response.json()) as Array<{ code: string }>;
        const codes = new Set(languages.map((language) => language.code));
        return codes.has('pt') && codes.has('en');
      } catch {
        return false;
      }
    },
  };
}

const DEEPL_TARGET: Record<Language, string> = { en: 'EN-US', pt: 'PT-BR', fr: 'FR', it: 'IT', es: 'ES' };

/** DeepL API (chave gratuita termina em ":fx" e usa o endpoint api-free). */
export function createDeepL(apiKey: string): MachineTranslator {
  const host = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const headers = { authorization: `DeepL-Auth-Key ${apiKey}` };
  return {
    name: 'deepl',
    external: true,
    async translate(texts, from, to) {
      const results: string[] = [];
      for (const group of batches(texts, 50, 100_000)) {
        const data = (await postJson(
          `${host}/v2/translate`,
          { text: group, source_lang: from.toUpperCase(), target_lang: DEEPL_TARGET[to], preserve_formatting: true },
          headers,
        )) as { translations?: Array<{ text: string }> };
        if (data.translations?.length !== group.length) throw new MachineTranslationFailed('Resposta do DeepL incompleta', false);
        results.push(...data.translations.map((item) => item.text));
      }
      return results;
    },
    async isAvailable() {
      try {
        const response = await fetch(`${host}/v2/usage`, { headers, signal: AbortSignal.timeout(5000) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

/** Provedores configurados no ambiente do worker. */
export function machineTranslatorsFromEnv(env: { LIBRETRANSLATE_URL?: string; LIBRETRANSLATE_API_KEY?: string; DEEPL_API_KEY?: string }) {
  const translators: Partial<Record<MachineProviderName, MachineTranslator>> = {};
  if (env.LIBRETRANSLATE_URL)
    translators.libretranslate = createLibreTranslate(env.LIBRETRANSLATE_URL, env.LIBRETRANSLATE_API_KEY || undefined);
  if (env.DEEPL_API_KEY) translators.deepl = createDeepL(env.DEEPL_API_KEY);
  return translators;
}

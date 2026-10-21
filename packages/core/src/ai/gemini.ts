/**
 * Cliente mínimo da API do Gemini (ADR-021): uma chamada de geração com resposta em JSON no formato pedido. Sem
 * ferramentas, sem acesso à internet, sem execução de código: o modelo só devolve texto estruturado, que o sistema
 * valida antes de usar.
 */

export class AiUnavailable extends Error {
  constructor(
    message: string,
    /** Cota, limite de requisições ou serviço fora do ar: vale tentar mais tarde. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly name: 'gemini';
  readonly model: string;
  /** Gera uma resposta em JSON para as instruções e a entrada dadas. */
  generate(request: { system: string; input: string; schema: Record<string, unknown> }): Promise<unknown>;
}

const TIMEOUT_MS = 45_000;

export function createGemini(apiKey: string, model = 'gemini-2.5-flash'): AiProvider {
  return {
    name: 'gemini',
    model,
    async generate({ system, input, schema }) {
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new AiUnavailable(`Gemini inacessível (${(error as Error).name})`, true);
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new AiUnavailable(
          response.status === 429 ? 'Cota do Gemini esgotada no momento' : `Gemini respondeu ${response.status}`,
          retryable,
        );
      }
      const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      try {
        return JSON.parse(text);
      } catch {
        throw new AiUnavailable('Resposta do Gemini fora do formato JSON', false);
      }
    },
  };
}

export function aiProviderFromEnv(env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }): AiProvider | null {
  return env.GEMINI_API_KEY ? createGemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined) : null;
}

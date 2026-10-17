/**
 * Limitador de janela fixa em memória, por processo (ADR-003).
 * Trocar por armazenamento compartilhado antes de executar mais de uma instância da API.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Retorna `true` se a tentativa ainda está dentro do limite. */
    hit(key: string) {
      const current = now();
      if (buckets.size > 10_000) {
        for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= current) buckets.delete(bucketKey);
      }
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + options.windowMs });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= options.limit;
    },
    reset(key: string) {
      buckets.delete(key);
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

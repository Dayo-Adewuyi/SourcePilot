export type RetryOptions = {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= opts.retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === opts.retries) break;
      const backoff = Math.min(opts.minDelayMs * 2 ** attempt, opts.maxDelayMs);
      await sleep(backoff);
      attempt += 1;
    }
  }

  throw lastError;
}

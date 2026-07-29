export interface RetryOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function linkAbortSignal(
  controller: AbortController,
  signal: AbortSignal | null | undefined,
): () => void {
  if (!signal) return () => undefined;
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Fetch with a bounded timeout and retry policy for idempotent reads only.
 * Callers must not use this helper for state-changing requests.
 */
export async function fetchReadWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 300);
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? 3_000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const unlinkAbort = linkAbortSignal(controller, init.signal);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) return response;
      response.body?.cancel().catch(() => undefined);
      const backoff = Math.min(
        maxDelayMs,
        retryAfterMs(response) ?? initialDelayMs * 2 ** (attempt - 1),
      );
      await delay(Math.floor(backoff * (0.85 + Math.random() * 0.3)), init.signal);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt === maxAttempts) throw error;
      const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      await delay(Math.floor(backoff * (0.85 + Math.random() * 0.3)), init.signal);
    } finally {
      clearTimeout(timer);
      unlinkAbort();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("read request failed");
}

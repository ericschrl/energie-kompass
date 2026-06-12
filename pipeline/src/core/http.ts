import type { HttpClient, HttpRequestOptions, HttpResponse } from './types.js';

export interface FetchHttpClientOptions {
  minDelayMs?: number;
  maxRetries?: number;
  userAgent?: string;
  defaultTimeoutMs?: number;
  /** Injektierbar für schnelle Tests. */
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class FetchHttpClient implements HttpClient {
  #lastRequestAt = 0;
  #count = 0;
  readonly #opts: Required<FetchHttpClientOptions>;

  constructor(opts: FetchHttpClientOptions = {}) {
    this.#opts = {
      minDelayMs: opts.minDelayMs ?? 1000,
      maxRetries: opts.maxRetries ?? 3,
      userAgent: opts.userAgent ?? 'energie-kompass-pipeline/0.1 (+https://github.com/ericschrl/energie-kompass)',
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 30_000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      fetchFn: opts.fetchFn ?? fetch,
    };
  }

  get requestCount(): number {
    return this.#count;
  }

  async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      'user-agent': this.#opts.userAgent,
      ...options.headers,
    };
    if (options.etag) headers['if-none-match'] = options.etag;
    if (options.lastModified) headers['if-modified-since'] = options.lastModified;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#opts.maxRetries; attempt++) {
      if (attempt > 0) {
        await this.#opts.sleep(backoffMs(attempt, lastError));
      }
      await this.#throttle();
      this.#count++;
      try {
        const res = await this.#opts.fetchFn(url, {
          method: options.method ?? 'GET',
          headers,
          body: options.body,
          redirect: 'follow',
          signal: AbortSignal.timeout(options.timeoutMs ?? this.#opts.defaultTimeoutMs),
        });
        if (RETRYABLE_STATUS.has(res.status)) {
          lastError = new HttpStatusError(url, res.status, res.headers.get('retry-after'));
          if (attempt < this.#opts.maxRetries) continue;
          throw lastError;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          buffer,
          text: buffer.toString('utf8'),
        };
      } catch (err) {
        lastError = err;
        if (attempt >= this.#opts.maxRetries || err instanceof HttpStatusError) throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`HTTP-Request fehlgeschlagen: ${url}`);
  }

  async #throttle(): Promise<void> {
    const wait = this.#lastRequestAt + this.#opts.minDelayMs - Date.now();
    if (wait > 0) await this.#opts.sleep(wait);
    this.#lastRequestAt = Date.now();
  }
}

export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly retryAfter: string | null = null,
  ) {
    super(`HTTP ${status} für ${url}`);
    this.name = 'HttpStatusError';
  }
}

function backoffMs(attempt: number, lastError: unknown): number {
  if (lastError instanceof HttpStatusError && lastError.retryAfter) {
    const seconds = Number.parseInt(lastError.retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  }
  const base = 1000 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

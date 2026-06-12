import { describe, expect, it } from 'vitest';

import { canonicalUrl } from '../src/core/canonicalUrl.js';
import { contentHash, sha256, titleDateHash } from '../src/core/hash.js';
import { FetchHttpClient, HttpStatusError } from '../src/core/http.js';

describe('hash', () => {
  it('contentHash ignoriert Whitespace-/Case-Rauschen', () => {
    expect(contentHash('Netzentgelte  2026', ' Reform ')).toBe(contentHash('netzentgelte 2026', 'reform'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('titleDateHash nutzt nur den Tagesanteil des Datums', () => {
    expect(titleDateHash('Titel', '2026-06-12T08:00:00Z')).toBe(titleDateHash('Titel', '2026-06-12T17:30:00Z'));
    expect(titleDateHash('Titel', '2026-06-12')).not.toBe(titleDateHash('Titel', '2026-06-13'));
  });

  it('sha256 liefert stabile Hex-Digests', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('canonicalUrl', () => {
  it('normalisiert Host, Schema, Tracking-Parameter und Fragment', () => {
    expect(
      canonicalUrl('http://www.Bundesnetzagentur.de/Presse/A.html?utm_source=rss&b=2&a=1#abschnitt'),
    ).toBe('https://bundesnetzagentur.de/Presse/A.html?a=1&b=2');
  });

  it('entfernt Trailing-Slash und Default-Port', () => {
    expect(canonicalUrl('https://example.org:443/pfad/')).toBe('https://example.org/pfad');
    expect(canonicalUrl('https://example.org/')).toBe('https://example.org');
  });

  it('lässt Nicht-URLs und leere Werte unverändert/undefined', () => {
    expect(canonicalUrl('BT-Drs. 21/123')).toBe('BT-Drs. 21/123');
    expect(canonicalUrl(undefined)).toBeUndefined();
    expect(canonicalUrl('')).toBeUndefined();
  });
});

describe('FetchHttpClient', () => {
  const noSleep = async () => {};

  it('wiederholt bei 5xx und liefert dann den Erfolg', async () => {
    let calls = 0;
    const client = new FetchHttpClient({
      minDelayMs: 0,
      sleep: noSleep,
      fetchFn: (async () => {
        calls++;
        return new Response(calls < 3 ? 'kaputt' : 'ok', { status: calls < 3 ? 503 : 200 });
      }) as typeof fetch,
    });
    const res = await client.request('https://example.org');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(calls).toBe(3);
    expect(client.requestCount).toBe(3);
  });

  it('gibt nach maxRetries den Statusfehler weiter', async () => {
    const client = new FetchHttpClient({
      minDelayMs: 0,
      maxRetries: 1,
      sleep: noSleep,
      fetchFn: (async () => new Response('zu viel', { status: 429 })) as typeof fetch,
    });
    await expect(client.request('https://example.org')).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('reicht 304 (Conditional GET) als normalen Response durch', async () => {
    const client = new FetchHttpClient({
      minDelayMs: 0,
      sleep: noSleep,
      fetchFn: (async (_url: string | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('if-none-match')).toBe('"etag-1"');
        return new Response(null, { status: 304 });
      }) as typeof fetch,
    });
    const res = await client.request('https://example.org/feed.xml', { etag: '"etag-1"' });
    expect(res.status).toBe(304);
    expect(res.ok).toBe(false);
  });

  it('dekodiert UTF-8-Umlaute korrekt', async () => {
    const client = new FetchHttpClient({
      minDelayMs: 0,
      sleep: noSleep,
      fetchFn: (async () => new Response('Wärmewende & Netzentgelte', { status: 200 })) as typeof fetch,
    });
    const res = await client.request('https://example.org');
    expect(res.text).toBe('Wärmewende & Netzentgelte');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as cheerio from 'cheerio';

import { config } from './config.js';
import { decodeXmlBuffer, parseFeed } from './connectors/rss.js';
import { FetchHttpClient } from './core/http.js';
import { createLogger } from './core/logger.js';

interface CandidateGroup {
  slug: string;
  name: string;
  overviewPages?: string[];
  candidates?: string[];
}

interface ProbeResult {
  slug: string;
  url: string;
  origin: 'candidate' | 'overview-link';
  status: number | 'ERR';
  isFeed: boolean;
  channelTitle?: string;
  itemCount?: number;
  latestPubDate?: string;
  note?: string;
}

const XML_LINK = /\.xml(\?|$)/i;

/**
 * Verifiziert Feed-URLs OHNE etwas zu schreiben (keine DB, kein Commit).
 * Läuft idealerweise im GitHub-Runner, wo der Egress zu Behörden-Servern offen ist.
 * Liest curated/feed-candidates.json, testet feste Kandidaten und alle *.xml-Links
 * der RSS-Übersichtsseiten, und meldet je URL Status + Feed-Sniff + Item-Zahl.
 */
export async function probeFeeds(candidatesFile?: string): Promise<ProbeResult[]> {
  const logger = createLogger('probe');
  const file = candidatesFile ?? resolve(config.curatedDir, 'feed-candidates.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { quellen: CandidateGroup[] };
  const http = new FetchHttpClient({ minDelayMs: 1500 });
  const results: ProbeResult[] = [];

  for (const group of parsed.quellen ?? []) {
    const urls = new Map<string, ProbeResult['origin']>();
    for (const c of group.candidates ?? []) urls.set(c, 'candidate');

    // Übersichtsseiten laden und *.xml-Links extrahieren.
    for (const page of group.overviewPages ?? []) {
      try {
        const res = await http.request(page, { headers: { accept: 'text/html' } });
        if (!res.ok) {
          logger.warn(`Übersicht ${page} → HTTP ${res.status}`);
          continue;
        }
        const $ = cheerio.load(res.text);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href || !XML_LINK.test(href)) return;
          const abs = new URL(href, page).toString();
          if (!urls.has(abs)) urls.set(abs, 'overview-link');
        });
      } catch (err) {
        logger.warn(`Übersicht ${page} nicht erreichbar: ${(err as Error).message}`);
      }
    }

    // Jede Kandidaten-URL testen.
    for (const [url, origin] of urls) {
      const r: ProbeResult = { slug: group.slug, url, origin, status: 'ERR', isFeed: false };
      try {
        const res = await http.request(url, {
          headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        });
        r.status = res.status;
        if (res.ok) {
          const xml = decodeXmlBuffer(res.buffer);
          if (/<rss|<feed|<rdf:RDF/i.test(xml.slice(0, 500))) {
            const items = parseFeed(xml);
            r.isFeed = true;
            r.itemCount = items.length;
            r.channelTitle = items[0]?.feedTitle;
            r.latestPubDate = items[0]?.pubDate;
          } else {
            r.note = 'kein Feed-Markup';
          }
        }
      } catch (err) {
        r.note = (err as Error).message;
      }
      results.push(r);
    }
  }

  return results;
}

export function formatProbeResults(results: ProbeResult[]): string {
  const lines: string[] = [];
  let currentSlug = '';
  for (const r of results) {
    if (r.slug !== currentSlug) {
      currentSlug = r.slug;
      lines.push(`\n══ ${r.slug} ══`);
    }
    const ok = r.isFeed && (r.itemCount ?? 0) > 0;
    const mark = ok ? '✅' : r.isFeed ? '⚠️ ' : '❌';
    const detail = r.isFeed
      ? `Feed "${r.channelTitle ?? '?'}" — ${r.itemCount} Items, neuestes: ${r.latestPubDate ?? '?'}`
      : `${r.note ?? 'kein Feed'}`;
    lines.push(`  ${mark} [${String(r.status).padEnd(3)}] (${r.origin}) ${r.url}`);
    lines.push(`        ${detail}`);
  }
  // Empfehlung je Quelle: erste bestätigte Feed-URL mit Items.
  lines.push('\n── Empfohlene Feed-URLs ──');
  const bySlug = new Map<string, ProbeResult>();
  for (const r of results) {
    if (r.isFeed && (r.itemCount ?? 0) > 0 && !bySlug.has(r.slug)) bySlug.set(r.slug, r);
  }
  for (const [slug, r] of bySlug) lines.push(`  ${slug}: ${r.url}`);
  if (bySlug.size === 0) lines.push('  (keine bestätigte Feed-URL — Kandidatenliste erweitern)');
  return lines.join('\n');
}

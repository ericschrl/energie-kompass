import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';

import { registerConnector } from '../core/registry.js';
import type {
  ConnectorContext, Cursor, FetchedItem, FetchResult, NormalizedInput, SourceConnector, SourceDescriptor,
} from '../core/types.js';

interface FeedConfig {
  url: string;
  docType?: string;
}

interface ParsedFeedItem {
  guid?: string;
  link?: string;
  title?: string;
  description?: string;
  pubDate?: string;
  feedTitle?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Standard- und numerische Entities auflösen (&auml; &#252; …)
  processEntities: true,
  htmlEntities: true,
});

/** Kleine Restmenge benannter HTML-Entities, die nach dem XML-Parsing übrig bleiben können. */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', agrave: 'à', ndash: '–', mdash: '—', sect: '§', euro: '€',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

/** HTML → Klartext: Tags raus, Entities decodieren, Whitespace normalisieren. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Payload-Bytes anhand des XML-Prologs dekodieren (ISO-8859-1-Feeds existieren noch). */
export function decodeXmlBuffer(buffer: Buffer): string {
  const head = buffer.subarray(0, 200).toString('latin1');
  const m = /encoding=["']([\w-]+)["']/i.exec(head);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  if (enc === 'utf-8' || enc === 'utf8') return buffer.toString('utf8');
  if (iconv.encodingExists(enc)) return iconv.decode(buffer, enc);
  return buffer.toString('utf8');
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  // CDATA/Attribut-Formen von fast-xml-parser: { '#text': '…' }
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return text((v as Record<string, unknown>)['#text']);
  }
  return undefined;
}

/** RSS 2.0 und Atom tolerant auf eine gemeinsame Item-Form bringen. */
export function parseFeed(xml: string): ParsedFeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF']?.channel;
  if (channel) {
    const feedTitle = text(channel.title);
    const items = asArray<Record<string, unknown>>(channel.item ?? doc?.['rdf:RDF']?.item);
    return items.map((it) => ({
      guid: text(it.guid) ?? text(it.link),
      link: text(it.link),
      title: text(it.title),
      description: text(it.description) ?? text(it['content:encoded']),
      // Datumsfeld variiert je Quelle (BNetzA-GSB-Feeds nutzen z.B. dcterms:date/date
      // statt pubDate); mehrere Kandidaten prüfen, damit published_at gesetzt wird.
      pubDate:
        text(it.pubDate) ?? text(it['dc:date']) ?? text(it['dcterms:date']) ??
        text(it['dcterms:created']) ?? text(it.date) ?? text(it.published) ?? text(it.updated),
      feedTitle,
    }));
  }
  const feed = doc?.feed;
  if (feed) {
    const feedTitle = text(feed.title);
    return asArray<Record<string, any>>(feed.entry).map((e) => {
      const links = asArray<Record<string, unknown>>(e.link);
      const href = (links.find((l) => l['@_rel'] === 'alternate') ?? links[0])?.['@_href'];
      return {
        guid: text(e.id) ?? (typeof href === 'string' ? href : undefined),
        link: typeof href === 'string' ? href : text(e.link),
        title: text(e.title),
        description: text(e.summary) ?? text(e.content),
        pubDate: text(e.updated) ?? text(e.published),
        feedTitle,
      };
    });
  }
  return [];
}

function toIso(pubDate: string | undefined): string | undefined {
  if (!pubDate) return undefined;
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Generischer Multi-Feed-RSS/Atom-Connector. Feeds stehen in descriptor.config.feeds
 * (curated/sources.seed.json). Inkrement je Feed über ETag/Last-Modified + pubDate-Cursor.
 */
export function rssConnector(descriptor: SourceDescriptor): SourceConnector {
  const feeds = ((descriptor.config?.feeds as FeedConfig[] | undefined) ?? []).filter((f) => f?.url);
  return {
    descriptor,
    async fetchSince(cursor: Cursor, ctx: ConnectorContext): Promise<FetchResult> {
      const items: FetchedItem[] = [];
      const nextCursor: Cursor = { ...cursor };
      for (const feed of feeds) {
        const etagKey = `etag:${feed.url}`;
        const lastModKey = `lastmod:${feed.url}`;
        const sinceKey = `since:${feed.url}`;
        let res;
        try {
          res = await ctx.http.request(feed.url, {
            etag: (cursor[etagKey] as string | undefined) ?? null,
            lastModified: (cursor[lastModKey] as string | undefined) ?? null,
            headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
          });
        } catch (err) {
          // Feed-Fehler isolieren: andere Feeds derselben Quelle weiter verarbeiten.
          ctx.logger.warn(`Feed nicht erreichbar: ${feed.url} — ${(err as Error).message}`);
          continue;
        }
        if (res.status === 304) {
          ctx.logger.info(`Feed unverändert (304): ${feed.url}`);
          continue;
        }
        if (!res.ok) {
          ctx.logger.warn(`Feed liefert HTTP ${res.status}: ${feed.url}`);
          continue;
        }
        const xml = decodeXmlBuffer(res.buffer);
        let parsed: ParsedFeedItem[];
        try {
          parsed = parseFeed(xml);
        } catch (err) {
          ctx.logger.warn(`Feed nicht parsebar: ${feed.url} — ${(err as Error).message}`);
          continue;
        }
        const since = cursor[sinceKey] as string | undefined;
        let maxSeen = since ?? '';
        for (const it of parsed) {
          const iso = toIso(it.pubDate);
          if (since && iso && iso <= since) continue;
          if (iso && iso > maxSeen) maxSeen = iso;
          items.push({
            externalId: it.guid ?? it.link,
            url: it.link,
            rawFormat: 'json',
            payload: JSON.stringify({ ...it, docType: feed.docType ?? 'pressemitteilung' }),
            publishedAt: iso,
          });
        }
        if (maxSeen) nextCursor[sinceKey] = maxSeen;
        const etag = res.headers.get('etag');
        const lastMod = res.headers.get('last-modified');
        if (etag) nextCursor[etagKey] = etag;
        if (lastMod) nextCursor[lastModKey] = lastMod;
      }
      return { items, nextCursor, exhausted: true };
    },
    normalize(item: FetchedItem): NormalizedInput[] {
      const data = JSON.parse(item.payload) as ParsedFeedItem & { docType: string };
      const title = htmlToText(data.title ?? '');
      if (!title) return [];
      const summary = data.description ? htmlToText(data.description) : undefined;
      return [
        {
          docType: data.docType,
          title,
          authorOrInstitution: descriptor.institution,
          publishedAt: toIso(data.pubDate),
          originalUrl: data.link,
          externalId: item.externalId,
          normalizedText: summary ?? null,
          summary,
          language: 'de',
        },
      ];
    },
  };
}

registerConnector('rss', rssConnector);

import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';

import { dateFromText, dateFromUrl, decodeXmlBuffer, htmlToText, parseFeed, resolveItemDate, rssConnector } from '../src/connectors/rss.js';
import type { ConnectorContext, HttpClient, HttpResponse } from '../src/core/types.js';

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Bundesnetzagentur Presse</title>
    <item>
      <title>Festlegung zur Netzentgeltsystematik ver&#xF6;ffentlicht</title>
      <link>https://www.bundesnetzagentur.de/presse/a1.html?utm_source=rss</link>
      <guid>bnetza-a1</guid>
      <description><![CDATA[<p>Die Beschlusskammer 8 hat die <b>Festlegung</b> f&uuml;r 2027 ver&ouml;ffentlicht.</p>]]></description>
      <pubDate>Fri, 12 Jun 2026 06:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Monitoringbericht erschienen</title>
      <link>https://www.bundesnetzagentur.de/presse/a2.html</link>
      <guid>bnetza-a2</guid>
      <description>Bericht zur Versorgungsqualit&#228;t.</description>
      <pubDate>Thu, 11 Jun 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

function fakeHttp(responses: Array<Partial<HttpResponse>>): HttpClient {
  let i = 0;
  let count = 0;
  return {
    get requestCount() { return count; },
    async request(): Promise<HttpResponse> {
      count++;
      const r = responses[Math.min(i++, responses.length - 1)] ?? {};
      const text = r.text ?? '';
      return {
        status: r.status ?? 200,
        ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
        headers: r.headers ?? new Headers(),
        text,
        buffer: r.buffer ?? Buffer.from(text, 'utf8'),
      };
    },
  };
}

function ctx(http: HttpClient): ConnectorContext {
  return {
    http,
    logger: { info() {}, warn() {}, error() {} },
    env: () => undefined,
    now: () => new Date('2026-06-12T12:00:00+02:00'),
  };
}

function connector() {
  return rssConnector({
    slug: 'rss-test',
    name: 'Bundesnetzagentur',
    institution: 'Bundesnetzagentur',
    sourceType: 'rss',
    accessType: 'public',
    licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
    rateLimit: { requestsPerMinute: 30 },
    config: { feeds: [{ url: 'https://example.org/feed.xml', docType: 'pressemitteilung' }] },
  });
}

describe('RSS-Connector', () => {
  it('parst RSS 2.0 inkl. CDATA, numerischer und benannter Entities', () => {
    const items = parseFeed(RSS_XML);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Festlegung zur Netzentgeltsystematik veröffentlicht');
    expect(items[0]?.guid).toBe('bnetza-a1');
  });

  it('fetchSince liefert Items, setzt pubDate-Cursor und ETag', async () => {
    const http = fakeHttp([
      { status: 200, text: RSS_XML, headers: new Headers({ etag: '"e-1"' }) },
    ]);
    const res = await connector().fetchSince({}, ctx(http));
    expect(res.items).toHaveLength(2);
    expect(res.exhausted).toBe(true);
    expect(res.nextCursor['since:https://example.org/feed.xml']).toBe('2026-06-12T06:30:00.000Z');
    expect(res.nextCursor['etag:https://example.org/feed.xml']).toBe('"e-1"');
  });

  it('filtert bereits gesehene Items über den since-Cursor', async () => {
    const res = await connector().fetchSince(
      { 'since:https://example.org/feed.xml': '2026-06-11T09:00:00.000Z' },
      ctx(fakeHttp([{ status: 200, text: RSS_XML }])),
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.externalId).toBe('bnetza-a1');
  });

  it('behandelt 304 (unverändert) als leeren, erfolgreichen Lauf', async () => {
    const res = await connector().fetchSince(
      { 'etag:https://example.org/feed.xml': '"e-1"' },
      ctx(fakeHttp([{ status: 304 }])),
    );
    expect(res.items).toHaveLength(0);
  });

  it('isoliert nicht erreichbare Feeds (kein Throw)', async () => {
    const http: HttpClient = {
      requestCount: 0,
      async request() { throw new Error('blocked'); },
    };
    const res = await connector().fetchSince({}, ctx(http));
    expect(res.items).toHaveLength(0);
  });

  it('normalize: HTML raus, Entities decodiert, docType aus Feed-Config', () => {
    const c = connector();
    const item = {
      externalId: 'bnetza-a1',
      url: 'https://www.bundesnetzagentur.de/presse/a1.html',
      rawFormat: 'json' as const,
      payload: JSON.stringify({
        guid: 'bnetza-a1',
        link: 'https://www.bundesnetzagentur.de/presse/a1.html',
        title: 'Festlegung ver&ouml;ffentlicht',
        description: '<p>Die <b>Festlegung</b> f&uuml;r 2027.</p>',
        pubDate: 'Fri, 12 Jun 2026 06:30:00 GMT',
        docType: 'pressemitteilung',
      }),
    };
    const [doc] = c.normalize(item);
    expect(doc?.title).toBe('Festlegung veröffentlicht');
    expect(doc?.summary).toBe('Die Festlegung für 2027.');
    expect(doc?.docType).toBe('pressemitteilung');
    expect(doc?.publishedAt).toBe('2026-06-12T06:30:00.000Z');
  });

  it('decodeXmlBuffer respektiert ISO-8859-1-Prolog', () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Wärme</title></channel></rss>`;
    const buf = iconv.encode(xml, 'ISO-8859-1');
    expect(decodeXmlBuffer(buf)).toContain('Wärme');
  });

  it('htmlToText: Tags, <br>, Whitespace', () => {
    expect(htmlToText('Zeile1<br/>Zeile2 <a href="#">Link&nbsp;Text</a>')).toBe('Zeile1 Zeile2 Link Text');
  });
});

describe('RSS: Dossier-Zuordnung (geteilte MatchRules)', () => {
  const rules = [
    { slug: 'netzentgelte', keywords: ['Netzentgelt', 'Netzentgelte'], patterns: [], topics: ['netz', 'netzentgelte'] },
  ];
  function c() {
    return rssConnector({
      slug: 'rss-bnetza', name: 'Bundesnetzagentur', institution: 'Bundesnetzagentur',
      sourceType: 'rss', accessType: 'public',
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
      rateLimit: { requestsPerMinute: 30 },
      config: { feeds: [{ url: 'https://x/feed.xml', docType: 'pressemitteilung' }] },
    }, { rules });
  }

  it('setzt dossierSlugs + topics, wenn der Titel zu einem Dossier passt', () => {
    const [doc] = c().normalize({
      externalId: 'a', rawFormat: 'json',
      payload: JSON.stringify({ title: 'BNetzA: Festlegung zu Netzentgelten 2027', link: 'https://x/a', docType: 'pressemitteilung' }),
    });
    expect(doc?.dossierSlugs).toEqual(['netzentgelte']);
    expect(doc?.topics).toEqual([{ topic: 'netz', frontendTag: 'netz' }, { topic: 'netzentgelte', frontendTag: 'netz' }]);
  });

  it('lässt dossierSlugs weg, wenn kein Dossier passt', () => {
    const [doc] = c().normalize({
      externalId: 'b', rawFormat: 'json',
      payload: JSON.stringify({ title: 'Hinweise zum Tierwohl', link: 'https://x/b', docType: 'pressemitteilung' }),
    });
    expect(doc?.dossierSlugs).toBeUndefined();
    expect(doc?.topics).toBeUndefined();
  });
});

describe('BNetzA-Datumsableitung (ohne Fake)', () => {
  const NOW = new Date('2026-06-30T00:00:00Z');

  it('dateFromUrl: BNetzA-CMS-Pfad mit YYYYMMDD im Dateinamen', () => {
    expect(
      dateFromUrl('http://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/DE/2026/20260615_NEP_Gas.html', NOW),
    ).toBe('2026-06-15T12:00:00.000Z');
  });

  it('dateFromUrl: /YYYY/MM/DD/-Pfadform', () => {
    expect(dateFromUrl('https://example.org/2026/06/05/artikel.html', NOW)).toBe('2026-06-05T12:00:00.000Z');
  });

  it('dateFromUrl: kein Datum / unplausibel / Zukunft → undefined', () => {
    expect(dateFromUrl('https://www.bundesnetzagentur.de/presse/a1.html', NOW)).toBeUndefined();
    expect(dateFromUrl('https://example.org/2026/13/40/x', NOW)).toBeUndefined(); // Monat 13 / Tag 40
    expect(dateFromUrl('https://example.org/2027/20271231_x.html', NOW)).toBeUndefined(); // weit in der Zukunft
  });

  it('dateFromText: dd.mm.yyyy und ISO; Jahresspannen werden ignoriert', () => {
    expect(dateFromText('Frist: Stellungnahme bis 30.06.2026.', NOW)).toBe('2026-06-30T12:00:00.000Z');
    expect(dateFromText('Stand 2026-06-05 veröffentlicht', NOW)).toBe('2026-06-05T12:00:00.000Z');
    // "2025-2037/2045" ist eine Jahresspanne, kein Datum:
    expect(dateFromText('Netzentwicklungsplan 2025-2037/2045', NOW)).toBeUndefined();
  });

  it('resolveItemDate: Reihenfolge Feed → URL → Beschreibung → collected', () => {
    expect(resolveItemDate({ pubDate: 'Fri, 12 Jun 2026 06:30:00 GMT', link: 'https://x/2024/20240101_a.html' }, NOW))
      .toEqual({ iso: '2026-06-12T06:30:00.000Z', source: 'feed' });
    expect(resolveItemDate({ link: 'https://www.bundesnetzagentur.de/.../2026/20260615_NEP_Gas.html' }, NOW))
      .toEqual({ iso: '2026-06-15T12:00:00.000Z', source: 'url' });
    expect(resolveItemDate({ description: 'erschienen am 05.06.2026' }, NOW))
      .toEqual({ iso: '2026-06-05T12:00:00.000Z', source: 'description' });
    expect(resolveItemDate({ title: 'Plan 2025-2037/2045', link: 'https://x/presse/ohne-datum.html' }, NOW))
      .toEqual({ source: 'collected' });
  });

  it('normalize: BNetzA-Item ohne pubDate erhält echtes Datum aus dem Link + date_source=url', () => {
    const c = rssConnector({
      slug: 'rss-bnetza', name: 'Bundesnetzagentur', institution: 'Bundesnetzagentur',
      sourceType: 'rss', accessType: 'public',
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
      rateLimit: { requestsPerMinute: 30 },
      config: { feeds: [{ url: 'https://x/feed.xml', docType: 'pressemitteilung' }] },
    });
    const [doc] = c.normalize({
      externalId: 'pm1', rawFormat: 'json',
      payload: JSON.stringify({
        title: 'Konsultation Netzentwicklungsplan Gas und Wasserstoff 2025-2037/2045',
        link: 'http://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/DE/2024/20240115_NEP.html',
        docType: 'pressemitteilung',
      }),
    });
    expect(doc?.publishedAt).toBe('2024-01-15T12:00:00.000Z');
    expect((doc?.meta as Record<string, unknown>)?.date_source).toBe('url');
  });

  it('normalize: ganz ohne Datum → publishedAt undefined, sauber als collected markiert', () => {
    const c = rssConnector({
      slug: 'rss-bnetza', name: 'Bundesnetzagentur', institution: 'Bundesnetzagentur',
      sourceType: 'rss', accessType: 'public',
      licence: { status: 'public-sector', allowsFulltextStorage: true, allowsRepublication: true },
      rateLimit: { requestsPerMinute: 30 },
      config: { feeds: [{ url: 'https://x/feed.xml', docType: 'pressemitteilung' }] },
    });
    const [doc] = c.normalize({
      externalId: 'gas1', rawFormat: 'json',
      payload: JSON.stringify({ title: 'Aktuelle Lage der Gasversorgung', link: 'https://www.bundesnetzagentur.de/gas/lage.html', docType: 'rss_article' }),
    });
    expect(doc?.publishedAt).toBeUndefined();
    expect((doc?.meta as Record<string, unknown>)?.date_source).toBe('collected');
    expect((doc?.meta as Record<string, unknown>)?.date_estimated).toBe(true);
  });
});

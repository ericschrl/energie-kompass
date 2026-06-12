import type { DatabaseSync } from 'node:sqlite';

import { formatNewsDatum, truncate } from '../format.js';
import { quelleColor, type Overlays } from '../overlays.js';

export interface NewsFrontendItem {
  id: string;
  titel: string;
  quelle: string;
  quelleColor: string;
  datum: string;
  tags: string[];
  zusammenfassung: string;
  link: string;
  gelesen: boolean;
}

export interface NewsProjection {
  items: NewsFrontendItem[];
  /** normalized_documents.id → vergebene news-ID (nur DB-Modus). */
  docIdToNewsId: Map<number, string>;
  /** Für Zitations-/Zustands-Persistenz (nur DB-Modus). */
  projectedDocs: Array<{ docId: number; newsId: string; url: string; licence: string; firstProjection: boolean }>;
  usedFallback: boolean;
}

interface NewsRow {
  id: number;
  title: string;
  summary: string | null;
  published_at: string;
  original_url: string | null;
  licence_status: string;
  first_projected_at: string | null;
  source_name: string;
}

/** Einfache MVP-Verschlagwortung auf die fixe Frontend-Taxonomie (max. 2 Tags). */
const TAG_RULES: Array<[string, RegExp]> = [
  ['eeg', /\bEEG\b|erneuerbare|photovoltaik|solar(park|anlage|energie)|wind(energie|kraft|park|räder)|ausschreibung/i],
  ['netz', /\bnetz(ausbau|entgelt|anschluss|betreiber)|stromnetz|übertragungsnetz|verteilnetz|§\s*14a|redispatch|smart\s*meter/i],
  ['emob', /elektromobil|lades(ä|ae)ule|ladeinfrastruktur|ladepunkt|e-?auto|\bV2G\b|bidirektional/i],
  ['ets', /emissionshandel|\bETS\b|CO2-?(preis|bepreisung|grenzausgleich)|\bCBAM\b|\bBEHG\b/i],
  ['markt', /strommarkt|kraftwerk|kapazitätsm|wasserstoff|speicher|strompreis|großhandel|versorgungssicherheit|gasmarkt/i],
];

export function frontendTags(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) tags.push(tag);
    if (tags.length === 2) break;
  }
  return tags;
}

const GELESEN_NACH_MS = 24 * 3600 * 1000;

/**
 * NEWS-Projektion: neueste veröffentlichungsfähige Dokumente aus der DB; solange die DB
 * leer ist, dienen die kuratierten Fallback-News als Platzhalter (verhindert leere UI).
 */
export function projectNews(db: DatabaseSync, overlays: Overlays, now: Date, limit = 30): NewsProjection {
  const rows = db
    .prepare(
      `SELECT nd.id, nd.title, nd.summary, nd.published_at, nd.original_url,
              nd.licence_status, nd.first_projected_at, s.name AS source_name
       FROM normalized_documents nd
       JOIN sources s ON s.id = nd.source_id
       JOIN source_licences sl ON sl.source_id = s.id
       WHERE nd.duplicate_of IS NULL
         AND nd.published_at IS NOT NULL
         AND nd.doc_type IN ('pressemitteilung','rss_article')
         AND sl.allows_republication = 1
         AND nd.licence_status NOT IN ('private-use-only','restricted')
       ORDER BY nd.published_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as NewsRow[];

  if (rows.length === 0) {
    return {
      items: overlays.newsFallback as NewsFrontendItem[],
      docIdToNewsId: new Map(),
      projectedDocs: [],
      usedFallback: true,
    };
  }

  const docIdToNewsId = new Map<number, string>();
  const projectedDocs: NewsProjection['projectedDocs'] = [];
  const items = rows.map((row, i) => {
    const newsId = `news-${i + 1}`;
    docIdToNewsId.set(row.id, newsId);
    projectedDocs.push({
      docId: row.id,
      newsId,
      url: row.original_url ?? '',
      licence: row.licence_status,
      firstProjection: row.first_projected_at === null,
    });
    const gelesen = row.first_projected_at !== null
      && now.getTime() - new Date(row.first_projected_at).getTime() > GELESEN_NACH_MS;
    return {
      id: newsId,
      titel: truncate(row.title, 140),
      quelle: row.source_name,
      quelleColor: quelleColor(overlays.quelleColors, row.source_name),
      datum: formatNewsDatum(row.published_at, now),
      tags: frontendTags(`${row.title} ${row.summary ?? ''}`),
      zusammenfassung: truncate(row.summary ?? row.title, 320),
      link: row.original_url ?? '#',
      gelesen,
    };
  });

  return { items, docIdToNewsId, projectedDocs, usedFallback: false };
}

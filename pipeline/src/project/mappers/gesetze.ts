import type { DatabaseSync } from 'node:sqlite';

import { deriveLegislationSignals } from '../legislationSignals.js';
import type { Overlays } from '../overlays.js';

/**
 * GESETZE-Projektion. Kuratierte Overlays sind die Basis und behalten Vorrang
 * für politische Bewertung (Priorität, Positionen, Ansprechpartner, Ressort,
 * Beschreibung, Tags, Phasenraster). Aus belegten Live-Signalen werden
 * faktenbasiert ergänzt bzw. überschrieben:
 *  - letzteAktion + quelle: aus deriveLegislationSignals (gepinnter DIP-Vorgang
 *    bzw. eindeutige offizielle Quelle); fehlt ein Signal, gilt der kuratierte
 *    Overlay-Fallback. So verlieren alte 2024-Demo-Werte gegen neuere belegte
 *    2026-Stände, ohne dass je politische Felder erfunden werden.
 *  - news: aus dossier_documents verknüpfte, projizierte NEWS (DIP + RSS),
 *    dedupliziert und nach Datum (neueste zuerst) sortiert.
 * phase, phasen und nächsterSchritt bleiben kuratiert (nur sicher Ableitbares).
 */
export function projectGesetze(
  db: DatabaseSync,
  overlays: Overlays,
  docIdToNewsId: Map<number, string>,
  newsUsedFallback: boolean,
): unknown[] {
  const dossierNews = newsDocsByFrontendGesetz(db);
  const signals = deriveLegislationSignals(db);
  return Object.entries(overlays.gesetze).map(([id, ov]) => {
    let news: string[];
    if (newsUsedFallback) {
      news = ov.fallback.news;
    } else {
      news = sortNewsNewestFirst(
        (dossierNews.get(id) ?? [])
          .map((docId) => docIdToNewsId.get(docId))
          .filter((n): n is string => n !== undefined),
      );
    }
    const sig = signals.get(id);
    return {
      id,
      name: ov.name,
      kurz: ov.kurz,
      beschreibung: ov.beschreibung,
      ressort: ov.ressort,
      referat: ov.referat,
      prioritaet: ov.prioritaet,
      phase: ov.fallback.phase,
      phasen: ov.fallback.phasen,
      tags: ov.tags,
      // Belegtes Live-Signal hat Vorrang; sonst kuratierter Stand (kein 2024 mehr).
      letzteAktion: sig?.letzteAktion ?? ov.fallback.letzteAktion,
      'nächsterSchritt': ov.fallback.naechsterSchritt,
      ansprechpartner: ov.ansprechpartner,
      positionen: ov.positionen,
      news,
      // Provenienz der letzteAktion (URL/Datum/Quellentyp) – Beleg, kein Frontend-Zwang.
      quelle: sig?.quelle ?? ov.fallback.quelle ?? null,
    };
  });
}

/** news-IDs nach Datum sortieren (neueste zuerst) und deduplizieren.
 *  projectNews vergibt news-1 (neueste) … news-N (älteste); der numerische
 *  Index entspricht also der Datumsordnung. */
function sortNewsNewestFirst(ids: string[]): string[] {
  const order = (id: string): number => {
    const m = id.match(/(\d+)/);
    return m && m[1] ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return [...new Set(ids)].sort((a, b) => order(a) - order(b));
}

function newsDocsByFrontendGesetz(db: DatabaseSync): Map<string, number[]> {
  const rows = db
    .prepare(
      `SELECT d.frontend_gesetz_id AS gid, dd.normalized_document_id AS doc_id
       FROM dossier_documents dd
       JOIN dossiers d ON d.id = dd.dossier_id
       WHERE d.frontend_gesetz_id IS NOT NULL
       ORDER BY dd.match_score DESC`,
    )
    .all() as Array<{ gid: string; doc_id: number }>;
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const list = map.get(r.gid) ?? [];
    list.push(r.doc_id);
    map.set(r.gid, list);
  }
  return map;
}

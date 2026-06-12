import type { DatabaseSync } from 'node:sqlite';

import { berlinDayKey, formatTerminTagMonat, formatUhrzeit } from '../format.js';
import type { Overlays } from '../overlays.js';

export interface TerminFrontendItem {
  tag: string;
  monat: string;
  titel: string;
  ort: string;
  typ: 'anhörung' | 'frist' | 'treffen' | 'ausschuss';
  gesetze_ref: string | null;
  uhrzeit: string;
}

/** Klassifikation auf exakt die 4 CSS-bekannten typ-Werte (inkl. Umlaut bei 'anhörung'). */
export function klassifiziereTermin(titel: string): TerminFrontendItem['typ'] {
  if (/frist|stellungnahme\s+bis|einreichung|deadline|konsultation\s+endet/i.test(titel)) return 'frist';
  if (/anhörung|anhoerung/i.test(titel)) return 'anhörung';
  if (/ausschuss|plenum|plenarsitzung|\blesung\b|sitzungswoche|bundesratssitzung|sitzung/i.test(titel)) return 'ausschuss';
  return 'treffen';
}

interface TerminRow {
  titel: string;
  event_date: string;
  ort: string | null;
  gesetz_id: string | null;
}

/** Kommende Termine: DB-Termine (doc_type='termin') + manuell kuratierte; sortiert, max. limit. */
export function projectTermine(db: DatabaseSync, overlays: Overlays, now: Date, limit = 10): TerminFrontendItem[] {
  const today = berlinDayKey(now);

  const dbRows = db
    .prepare(
      `SELECT nd.title AS titel,
              json_extract(nd.meta_json, '$.event_date') AS event_date,
              json_extract(nd.meta_json, '$.ort') AS ort,
              (SELECT d.frontend_gesetz_id FROM dossier_documents dd
                 JOIN dossiers d ON d.id = dd.dossier_id
                WHERE dd.normalized_document_id = nd.id AND d.frontend_gesetz_id IS NOT NULL
                ORDER BY dd.match_score DESC LIMIT 1) AS gesetz_id
       FROM normalized_documents nd
       WHERE nd.doc_type = 'termin'
         AND json_extract(nd.meta_json, '$.event_date') >= ?
       ORDER BY event_date`,
    )
    .all(today) as unknown as TerminRow[];

  const candidates: Array<{ iso: string; item: TerminFrontendItem }> = [];

  for (const row of dbRows) {
    if (!row.event_date) continue;
    const { tag, monat } = formatTerminTagMonat(row.event_date);
    candidates.push({
      iso: row.event_date,
      item: {
        tag,
        monat,
        titel: row.titel,
        ort: row.ort ?? '–',
        typ: klassifiziereTermin(row.titel),
        gesetze_ref: row.gesetz_id ?? null,
        uhrzeit: formatUhrzeit(row.event_date),
      },
    });
  }

  for (const m of overlays.termineManual) {
    if (!m.datumIso || m.datumIso.slice(0, 10) < today) continue;
    const { tag, monat } = formatTerminTagMonat(m.datumIso);
    candidates.push({
      iso: m.datumIso,
      item: {
        tag,
        monat,
        titel: m.titel,
        ort: m.ort,
        typ: m.typ ?? klassifiziereTermin(m.titel),
        gesetze_ref: m.gesetze_ref ?? null,
        uhrzeit: m.uhrzeit ?? formatUhrzeit(m.datumIso),
      },
    });
  }

  candidates.sort((a, b) => a.iso.localeCompare(b.iso));
  return candidates.slice(0, limit).map((c) => c.item);
}

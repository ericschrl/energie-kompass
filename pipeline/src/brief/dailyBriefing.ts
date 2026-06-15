import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';
import { berlinDayKey, formatDatumKurz, formatNewsDatum } from '../project/format.js';
import { loadOverlays } from '../project/overlays.js';
import { projectTermine } from '../project/mappers/termine.js';

interface BriefRow {
  id: number;
  title: string;
  summary: string | null;
  published_at: string | null;
  collected_at: string;
  original_url: string | null;
  licence_status: string;
  source_name: string;
  attribution_text: string | null;
}

/**
 * Einfaches quellenbasiertes Tages-Briefing (Template, kein LLM):
 * neue Meldungen der letzten 24h mit Link je Aussage, anstehende Termine,
 * Status der Gesetzes-Dossiers. Jede gelistete Quelle wird in citations protokolliert.
 */
export function writeDailyBriefing(db: DatabaseSync, now: Date = new Date()): { path: string; neueMeldungen: number } {
  const overlays = loadOverlays();
  const dayKey = berlinDayKey(now);
  const sinceIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT nd.id, nd.title, nd.summary, nd.published_at, nd.collected_at, nd.original_url,
              nd.licence_status, s.name AS source_name, sl.attribution_text
       FROM normalized_documents nd
       JOIN sources s ON s.id = nd.source_id
       JOIN source_licences sl ON sl.source_id = s.id
       WHERE nd.duplicate_of IS NULL
         AND sl.allows_republication = 1
         AND nd.licence_status NOT IN ('private-use-only')
         AND (COALESCE(nd.published_at, nd.collected_at) >= ? OR nd.created_at >= ?)
       ORDER BY s.name, COALESCE(nd.published_at, nd.collected_at) DESC`,
    )
    .all(sinceIso, sinceIso) as unknown as BriefRow[];

  const lines: string[] = [];
  lines.push(`# Energie-Kompass Briefing — ${formatDatumKurz(now.toISOString())}`);
  lines.push('');
  lines.push('## Neu seit gestern');
  lines.push('');
  if (rows.length === 0) {
    lines.push('_Keine neuen Meldungen in den letzten 24 Stunden (oder noch kein Ingestion-Lauf)._');
    lines.push('');
  } else {
    let currentSource = '';
    for (const r of rows) {
      if (r.source_name !== currentSource) {
        currentSource = r.source_name;
        lines.push(`### ${currentSource}`);
        lines.push('');
      }
      const datum = r.published_at ? formatNewsDatum(r.published_at, now) : 'heute eingesammelt';
      const link = r.original_url ? `[${r.title}](${r.original_url})` : r.title;
      lines.push(`- ${link} — ${datum}`);
      if (r.summary && r.summary !== r.title) lines.push(`  ${r.summary}`);
      lines.push('');
    }
  }

  lines.push('## Anstehende Termine');
  lines.push('');
  const termine = projectTermine(db, overlays, now, 15);
  if (termine.length === 0) {
    lines.push('_Keine bekannten Termine. Manuelle Termine in pipeline/curated/termine.manual.json pflegen._');
  } else {
    for (const t of termine) {
      lines.push(`- **${t.tag}. ${t.monat}**, ${t.uhrzeit} — ${t.titel} (${t.typ}, ${t.ort})`);
    }
  }
  lines.push('');

  lines.push('## Gesetzgebungs-Tracker (Stand)');
  lines.push('');
  for (const [id, ov] of Object.entries(overlays.gesetze)) {
    const aktiv = ov.fallback.phasen[ov.fallback.phase]?.label.replace(/\n/g, '') ?? '–';
    lines.push(`- **${ov.kurz}** (${id}): Phase „${aktiv}" — nächster Schritt: ${ov.fallback.naechsterSchritt}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('_Automatisch generiert von der Energie-Kompass-Pipeline. Alle Meldungen mit Quellenlink;_');
  lines.push('_amtliche Quellen gemäß Quellenangabe (z. B. Bundesnetzagentur, BMWE)._');
  lines.push('');

  mkdirSync(config.briefingsDir, { recursive: true });
  const path = join(config.briefingsDir, `${dayKey}.md`);
  writeFileSync(path, lines.join('\n'), 'utf8');

  const ref = `briefings/${dayKey}.md`;
  const cite = db.prepare(
    `INSERT INTO citations (normalized_document_id, used_in, used_in_ref, url, accessed_at, licence_status)
     SELECT ?, 'briefing', ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM citations WHERE normalized_document_id = ? AND used_in = 'briefing' AND used_in_ref = ?
     )`,
  );
  for (const r of rows) {
    cite.run(r.id, ref, r.original_url ?? '', now.toISOString(), r.licence_status, r.id, ref);
  }

  return { path, neueMeldungen: rows.length };
}

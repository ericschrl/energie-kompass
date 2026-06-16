import type { DatabaseSync } from 'node:sqlite';

// Read-only-Helfer: listet je Gesetz-Dossier die verknüpften DIP-Vorgänge mit
// ID/Titel/Datum/Beratungsstand/Link, damit dip_vorgang_id BEWUSST kuratiert
// werden kann. Setzt selbst NICHTS.

export interface DipCandidate {
  vorgangId: string;
  title: string;
  date: string | null;
  beratungsstand: string | null;
  url: string | null;
}
export interface GesetzCandidates {
  frontendGesetzId: string;
  pinned: string | null; // bereits kuratierte dip_vorgang_id (falls gesetzt)
  candidates: DipCandidate[];
}

export function collectDipCandidates(db: DatabaseSync): GesetzCandidates[] {
  const dossiers = db
    .prepare(
      `SELECT frontend_gesetz_id AS gid, dip_vorgang_id AS pinned
       FROM dossiers WHERE frontend_gesetz_id IS NOT NULL ORDER BY frontend_gesetz_id`,
    )
    .all() as Array<{ gid: string; pinned: string | null }>;

  const candStmt = db.prepare(
    `SELECT nd.external_id AS ext, nd.title, nd.published_at AS d, nd.original_url AS url,
            json_extract(nd.meta_json,'$.beratungsstand') AS stand
     FROM dossier_documents dd
     JOIN dossiers d ON d.id = dd.dossier_id
     JOIN normalized_documents nd ON nd.id = dd.normalized_document_id
     WHERE d.frontend_gesetz_id = ? AND nd.doc_type = 'vorgang' AND nd.duplicate_of IS NULL
     ORDER BY nd.published_at DESC`,
  );

  return dossiers.map(({ gid, pinned }) => {
    const rows = candStmt.all(gid) as Array<{ ext: string; title: string; d: string | null; url: string | null; stand: string | null }>;
    return {
      frontendGesetzId: gid,
      pinned: pinned ?? null,
      candidates: rows.map((r) => ({
        vorgangId: r.ext.replace(/^dip-vorgang-/, ''),
        title: r.title,
        date: r.d ? r.d.slice(0, 10) : null,
        beratungsstand: r.stand,
        url: r.url,
      })),
    };
  });
}

export function formatDipCandidates(groups: GesetzCandidates[]): string {
  const lines: string[] = [];
  lines.push('DIP-Kandidaten je Gesetz-Dossier (dip_vorgang_id bewusst in dossiers.seed.json setzen):');
  for (const g of groups) {
    lines.push(`\n■ ${g.frontendGesetzId}${g.pinned ? `  [gepinnt: ${g.pinned}]` : '  [kein Pin]'}`);
    if (g.candidates.length === 0) {
      lines.push('   (keine verknüpften DIP-Vorgänge — ggf. erst nach einem DIP-Lauf mit Key)');
      continue;
    }
    for (const c of g.candidates) {
      lines.push(`   • id=${c.vorgangId}  ${c.date ?? '?'}  [${c.beratungsstand ?? '—'}]  ${c.title}`);
      if (c.url) lines.push(`        ${c.url}`);
    }
  }
  return lines.join('\n');
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from '../config.js';

export interface GesetzOverlay {
  name: string;
  kurz: string;
  beschreibung: string;
  ressort: string;
  referat: string;
  prioritaet: string;
  tags: string[];
  ansprechpartner: unknown;
  positionen: unknown[];
  fallback: {
    phase: number;
    phasen: Array<{ label: string; datum: string; status: string }>;
    letzteAktion: string;
    naechsterSchritt: string;
    news: string[];
    /**
     * Provenienz des kuratierten Stands (URL/Datum/Quellentyp). Belegt, woher der
     * Fallback-Stand stammt, und ist die Basis für die Projektion, wenn kein
     * Live-Signal vorliegt. Wird von einem abgeleiteten Signal überschrieben.
     */
    quelle?: { url: string | null; datum: string | null; typ: string };
  };
}

/** Provenienz einer Gesetzgebungs-Aktualisierung (im data.js als GESETZE[].quelle). */
export interface GesetzQuelle {
  url: string | null;
  datum: string | null; // 'YYYY-MM-DD'
  typ: string; // 'DIP' | 'BMWE' | 'Bundesregierung' | 'BNetzA' | 'kuratiert' | …
}

export interface ManualTermin {
  datumIso: string; // 'YYYY-MM-DD' oder mit Zeit
  titel: string;
  ort: string;
  typ: 'anhörung' | 'frist' | 'treffen' | 'ausschuss';
  gesetze_ref: string | null;
  uhrzeit?: string;
  /** URL der öffentlichen Belegstelle (Nachweis; wird beim Projizieren ignoriert). */
  quelle?: string;
}

function readJson<T>(name: string, fallback: T, dir: string): T {
  const file = resolve(dir, name);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export interface Overlays {
  gesetze: Record<string, GesetzOverlay>;
  stakeholder: unknown[];
  kontakte: unknown[];
  newsFallback: unknown[];
  termineManual: ManualTermin[];
  quelleColors: Record<string, string>;
}

export function loadOverlays(dir: string = config.curatedDir): Overlays {
  return {
    gesetze: readJson('gesetze.overlay.json', {}, dir),
    stakeholder: readJson('stakeholder.overlay.json', [], dir),
    kontakte: readJson('kontakte.json', [], dir),
    newsFallback: readJson('news.fallback.json', [], dir),
    termineManual: readJson('termine.manual.json', [], dir),
    quelleColors: readJson('quelle-colors.json', {}, dir),
  };
}

export function quelleColor(colors: Record<string, string>, quelle: string): string {
  return colors[quelle] ?? colors['_default'] ?? '#888';
}

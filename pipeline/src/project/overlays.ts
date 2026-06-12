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
  };
}

export interface ManualTermin {
  datumIso: string; // 'YYYY-MM-DD' oder mit Zeit
  titel: string;
  ort: string;
  typ: 'anhörung' | 'frist' | 'treffen' | 'ausschuss';
  gesetze_ref: string | null;
  uhrzeit?: string;
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

// Datums-/Serialisierungshelfer für die Frontend-Projektion.
// Alle Anzeige-Formate sind Frontend-Vertrag: 'Heute, HH:MM' | 'Gestern, HH:MM' | 'DD.MM.YYYY',
// Monatskürzel deutsch, Berechnung strikt in Europe/Berlin (CI-Runner laufen in UTC).

const TZ = 'Europe/Berlin';

export const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'] as const;

interface BerlinParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: string; // '09'
  minute: string; // '05'
}

export function berlinParts(d: Date): BerlinParts {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: (p.hour ?? '00').padStart(2, '0'),
    minute: (p.minute ?? '00').padStart(2, '0'),
  };
}

/** Kalendertag in Berlin als 'YYYY-MM-DD'. */
export function berlinDayKey(d: Date): string {
  const p = berlinParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** NEWS.datum: 'Heute, HH:MM' | 'Gestern, HH:MM' | 'DD.MM.YYYY' (Berlin-Zeit). */
export function formatNewsDatum(publishedAt: string, now: Date): string {
  const pub = new Date(publishedAt);
  if (Number.isNaN(pub.getTime())) return publishedAt;
  const pubDay = berlinDayKey(pub);
  const p = berlinParts(pub);
  if (pubDay === berlinDayKey(now)) return `Heute, ${p.hour}:${p.minute}`;
  if (pubDay === berlinDayKey(new Date(now.getTime() - 24 * 3600 * 1000))) return `Gestern, ${p.hour}:${p.minute}`;
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/** 'DD.MM.YYYY' für letzteAktion u.ä. */
export function formatDatumKurz(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = berlinParts(d);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/** 'Jun 2026' für phasen[].datum. */
export function formatMonatJahr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = berlinParts(d);
  return `${MONATE_KURZ[p.month - 1]} ${p.year}`;
}

/** TERMINE: { tag: '02' (zero-padded String!), monat: 'Jun' }. */
export function formatTerminTagMonat(iso: string): { tag: string; monat: string } {
  const d = new Date(iso);
  const p = berlinParts(d);
  return { tag: String(p.day).padStart(2, '0'), monat: MONATE_KURZ[p.month - 1] ?? '' };
}

/** 'HH:MM Uhr' oder 'ganztägig', aus ISO mit/ohne Zeitanteil. */
export function formatUhrzeit(iso: string): string {
  if (!/T\d{2}:\d{2}/.test(iso)) return 'ganztägig';
  const p = berlinParts(new Date(iso));
  if (p.hour === '00' && p.minute === '00') return 'ganztägig';
  return `${p.hour}:${p.minute} Uhr`;
}

export function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * data.js-Serialisierung: Original-Reihenfolge der 5 Konstanten, JSON.stringify mit
 * 2er-Einrückung (Umlaute bleiben roh, '\n' in Strings wird als Escape ausgegeben,
 * Keys wie "nächsterSchritt" gequotet — gültiges JS), UTF-8 ohne BOM, LF.
 */
export function serializeDataJs(data: {
  GESETZE: unknown[];
  NEWS: unknown[];
  TERMINE: unknown[];
  STAKEHOLDER: unknown[];
  KONTAKTE: unknown[];
}, generatedAt: Date): string {
  const block = (name: keyof typeof data) => `const ${name} = ${JSON.stringify(data[name], null, 2)};`;
  return [
    '// ─── Energie-Kompass Data ───',
    `// GENERIERT durch pipeline/ – nicht von Hand editieren (Stand: ${generatedAt.toISOString()})`,
    '// Kuratierte Inhalte pflegen in pipeline/curated/, dann: cd pipeline && npm run project',
    '',
    block('GESETZE'),
    '',
    block('NEWS'),
    '',
    block('TERMINE'),
    '',
    block('STAKEHOLDER'),
    '',
    block('KONTAKTE'),
    '',
  ].join('\n');
}

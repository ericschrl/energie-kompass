import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config.js';
import { formatDatumKurz } from './format.js';

// Wandelt die Markdown-Briefings (briefings/YYYY-MM-DD.md) in eine strukturierte,
// frontend-freundliche Indexdatei src/data/briefings.js um. Deterministisch (kein
// Zeitstempel ⇒ keine Leerlauf-Commits), Pages-tauglich (statisches JS-Global).

export interface BriefingSpan {
  text: string;
  href?: string;
}
export interface BriefingBlock {
  kind: 'bullet' | 'para' | 'note';
  spans: BriefingSpan[];
  sub?: string;
}
export interface BriefingSection {
  heading: string | null;
  level: 2 | 3;
  blocks: BriefingBlock[];
}
export interface ParsedBriefing {
  date: string;
  title: string;
  sections: BriefingSection[];
}

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

function stripBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1');
}

/** Inline-Text in Text-/Link-Spans zerlegen (für sicheres DOM-Rendering im Frontend). */
export function parseSpans(text: string): BriefingSpan[] {
  const clean = stripBold(text);
  const spans: BriefingSpan[] = [];
  let last = 0;
  for (const m of clean.matchAll(LINK)) {
    const idx = m.index ?? 0;
    if (idx > last) spans.push({ text: clean.slice(last, idx) });
    spans.push({ text: m[1]!, href: m[2]! });
    last = idx + m[0].length;
  }
  if (last < clean.length) spans.push({ text: clean.slice(last) });
  return spans.length ? spans : [{ text: clean }];
}

/** Ein Briefing-Markdown in Titel/Datum/Abschnitte zerlegen. */
export function parseBriefingMarkdown(md: string, date: string): ParsedBriefing {
  const lines = md.split('\n');
  let title = `Briefing ${date}`;
  const sections: BriefingSection[] = [];
  let current: BriefingSection | null = null;

  const ensureSection = (): BriefingSection => {
    if (!current) {
      current = { heading: null, level: 2, blocks: [] };
      sections.push(current);
    }
    return current;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('# ')) { title = stripBold(line.slice(2).trim()); continue; }
    if (line.startsWith('### ')) { current = { heading: stripBold(line.slice(4).trim()), level: 3, blocks: [] }; sections.push(current); continue; }
    if (line.startsWith('## ')) { current = { heading: stripBold(line.slice(3).trim()), level: 2, blocks: [] }; sections.push(current); continue; }
    if (/^[-*]\s+/.test(line)) {
      ensureSection().blocks.push({ kind: 'bullet', spans: parseSpans(line.replace(/^[-*]\s+/, '')) });
      continue;
    }
    if (/^\s{2,}\S/.test(raw)) {
      // Eingerückte Fortsetzungszeile → Untertext des letzten Bullets.
      const blocks = current?.blocks ?? [];
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.kind === 'bullet') { lastBlock.sub = stripBold(raw.trim()); continue; }
    }
    if (line.startsWith('---')) continue;
    const isNote = /^_.*_$/.test(line.trim());
    ensureSection().blocks.push({
      kind: isNote ? 'note' : 'para',
      spans: parseSpans(isNote ? line.trim().replace(/^_|_$/g, '') : line.trim()),
    });
  }
  return { date, title, sections };
}

export function buildBriefingsIndex(briefingsDir: string, limit = 30): { all: ParsedBriefing[] } {
  if (!existsSync(briefingsDir)) return { all: [] };
  const files = readdirSync(briefingsDir)
    .map((f) => DATE_FILE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[0], date: m[1]! }))
    .sort((a, b) => b.date.localeCompare(a.date)) // neueste zuerst
    .slice(0, limit);
  const all = files.map(({ file, date }) => parseBriefingMarkdown(readFileSync(join(briefingsDir, file), 'utf8'), date));
  return { all };
}

/** src/data/briefings.js schreiben (globales BRIEFINGS, wie die übrigen data-Dateien). */
export function writeBriefingsIndex(
  opts: { briefingsDir?: string; outPath?: string } = {},
): { path: string; count: number } {
  const briefingsDir = opts.briefingsDir ?? config.briefingsDir;
  const outPath = opts.outPath ?? config.briefingsDataPath;
  const index = buildBriefingsIndex(briefingsDir);
  const content =
    '// ─── Energie-Kompass Briefings ───\n' +
    '// GENERIERT durch pipeline/ aus briefings/*.md – nicht von Hand editieren.\n' +
    `const BRIEFINGS = ${JSON.stringify(index, null, 2)};\n`;
  writeFileSync(outPath, content, 'utf8');
  return { path: outPath, count: index.all.length };
}

/** Anzeigedatum (DD.MM.YYYY) aus einem ISO-Tag — für Tests/Hilfsausgaben. */
export function displayDate(isoDay: string): string {
  return formatDatumKurz(`${isoDay}T12:00:00Z`);
}

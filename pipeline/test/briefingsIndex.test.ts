import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';

import { buildBriefingsIndex, parseBriefingMarkdown, parseSpans, writeBriefingsIndex } from '../src/project/briefingsIndex.js';

const SAMPLE = `# Energie-Kompass Briefing — 15.06.2026

## Neu seit gestern

### Bundesnetzagentur

- [Festlegung zu Netzentgelten](https://www.bundesnetzagentur.de/x) — Heute, 09:00
  Die Beschlusskammer hat entschieden.

## Anstehende Termine

- **20. Jun**, 10:00 Uhr — Anhörung (anhörung, Bundestag, Berlin)

---
_Automatisch generiert von der Energie-Kompass-Pipeline._
`;

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ek-brief-'));
  tmpDirs.push(d);
  return d;
}
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('parseSpans', () => {
  it('trennt Text und Links', () => {
    expect(parseSpans('[Titel](https://x/y) — Heute, 09:00')).toEqual([
      { text: 'Titel', href: 'https://x/y' },
      { text: ' — Heute, 09:00' },
    ]);
  });
  it('entfernt Fettmarkierung', () => {
    expect(parseSpans('**20. Jun**, 10:00 Uhr')).toEqual([{ text: '20. Jun, 10:00 Uhr' }]);
  });
});

describe('parseBriefingMarkdown', () => {
  const b = parseBriefingMarkdown(SAMPLE, '2026-06-15');

  it('liest Titel und Datum', () => {
    expect(b.title).toBe('Energie-Kompass Briefing — 15.06.2026');
    expect(b.date).toBe('2026-06-15');
  });

  it('strukturiert Abschnitte mit Level (## = 2, ### = 3)', () => {
    const headings = b.sections.map((s) => `${s.level}:${s.heading}`);
    expect(headings).toContain('2:Neu seit gestern');
    expect(headings).toContain('3:Bundesnetzagentur');
    expect(headings).toContain('2:Anstehende Termine');
  });

  it('parst Bullet mit Link-Span und eingerücktem Untertext', () => {
    const src = b.sections.find((s) => s.heading === 'Bundesnetzagentur')!;
    const bullet = src.blocks[0]!;
    expect(bullet.kind).toBe('bullet');
    expect(bullet.spans[0]).toEqual({ text: 'Festlegung zu Netzentgelten', href: 'https://www.bundesnetzagentur.de/x' });
    expect(bullet.sub).toBe('Die Beschlusskammer hat entschieden.');
  });

  it('erkennt Notiz-Zeilen (_..._)', () => {
    const note = b.sections.flatMap((s) => s.blocks).find((bl) => bl.kind === 'note');
    expect(note?.spans[0]?.text).toContain('Automatisch generiert');
  });
});

describe('buildBriefingsIndex', () => {
  it('listet Briefings neueste-zuerst, ignoriert Nicht-Datumsdateien, cappt', () => {
    const dir = freshDir();
    writeFileSync(join(dir, '2026-06-14.md'), '# Briefing 14\n\n## A\n\n- x\n');
    writeFileSync(join(dir, '2026-06-15.md'), '# Briefing 15\n\n## A\n\n- y\n');
    writeFileSync(join(dir, 'README.md'), '# kein Briefing');
    const idx = buildBriefingsIndex(dir, 30);
    expect(idx.all.map((b) => b.date)).toEqual(['2026-06-15', '2026-06-14']);
  });

  it('leeres / fehlendes Verzeichnis → { all: [] } (kein Crash)', () => {
    expect(buildBriefingsIndex(join(tmpdir(), 'ek-does-not-exist-xyz'))).toEqual({ all: [] });
    expect(buildBriefingsIndex(freshDir())).toEqual({ all: [] });
  });
});

describe('writeBriefingsIndex', () => {
  it('schreibt gültiges JS-Global BRIEFINGS (vm-ladbar, deterministisch)', () => {
    const dir = freshDir();
    writeFileSync(join(dir, '2026-06-15.md'), SAMPLE);
    const out = join(freshDir(), 'briefings.js');
    const a = writeBriefingsIndex({ briefingsDir: dir, outPath: out });
    expect(a.count).toBe(1);
    const code = readFileSync(out, 'utf8');
    const ctx = vm.runInNewContext(`${code}; BRIEFINGS`, {}) as { all: Array<{ title: string }> };
    expect(Array.isArray(ctx.all)).toBe(true);
    expect(ctx.all[0]?.title).toBe('Energie-Kompass Briefing — 15.06.2026');
    // deterministisch: erneuter Lauf ⇒ identischer Inhalt
    writeBriefingsIndex({ briefingsDir: dir, outPath: out });
    expect(readFileSync(out, 'utf8')).toBe(code);
  });
});

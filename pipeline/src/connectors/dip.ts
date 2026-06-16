import { registerConnector } from '../core/registry.js';
import { loadDossierRules, matchDossiers, type DossierMatch, type DossierRule, type FrontendTag } from '../enrich/dossierMatch.js';
import type {
  ConnectorContext, Cursor, FetchedItem, FetchResult, NormalizedInput, SourceConnector, SourceDescriptor,
} from '../core/types.js';

// ── DIP-API des Deutschen Bundestages ───────────────────────────────────────
// Endpunkte: /vorgang (Spine) + /vorgangsposition?f.vorgang=<id>.
// Auth ausschließlich über ENV/Secret DIP_API_KEY (Header "Authorization: ApiKey …").
// Ohne Key überspringt der Connector sauber (0 Items), ohne den Lauf zu brechen.
// Dossier-Matchlogik liegt zentral in ../enrich/dossierMatch.ts (geteilt mit RSS).

// Re-Export für bestehende Importe/Tests, die diese Symbole aus dip.js beziehen.
export { loadDossierRules, matchDossiers };
export type { DossierMatch, DossierRule, FrontendTag };

interface DipConfig {
  keywords: string[];
  wahlperiode?: number;
  vorgangstyp?: string;
  maxVorgaenge: number;
  maxPagesPerKeyword: number;
}

function readConfig(descriptor: SourceDescriptor): DipConfig {
  const c = (descriptor.config ?? {}) as Record<string, unknown>;
  return {
    keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
    wahlperiode: typeof c.wahlperiode === 'number' ? c.wahlperiode : undefined,
    vorgangstyp: typeof c.vorgangstyp === 'string' ? c.vorgangstyp : undefined,
    maxVorgaenge: typeof c.maxVorgaengeProLauf === 'number' ? c.maxVorgaengeProLauf : 40,
    maxPagesPerKeyword: typeof c.maxPagesPerKeyword === 'number' ? c.maxPagesPerKeyword : 5,
  };
}

function toIso(d: string | undefined): string | undefined {
  if (!d) return undefined;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

interface DipVorgang {
  id?: string | number;
  titel?: string;
  datum?: string;
  aktualisiert?: string;
  vorgangstyp?: string;
  wahlperiode?: number;
  beratungsstand?: string;
  gesta?: string;
  abstract?: string;
  initiative?: string[];
  sachgebiet?: string[];
  fundstelle?: { pdf_url?: string; dokumentnummer?: string };
}
interface DipPosition {
  id?: string | number;
  vorgangsposition?: string;
  zuordnung?: string;
  datum?: string;
  vorgang_id?: string | number;
  fundstelle?: { pdf_url?: string; dokumentnummer?: string; dokumentart?: string; drucksachetyp?: string };
}
interface DipResponse<T> {
  numFound?: number;
  documents?: T[];
  cursor?: string;
}

function vorgangUrl(v: DipVorgang): string {
  return v.fundstelle?.pdf_url ?? `https://dip.bundestag.de/vorgang/${v.id}`;
}

/** DIP-Connector. Dossier-Regeln werden injizierbar gehalten (Tests ohne curated/-Datei). */
export function dipConnector(descriptor: SourceDescriptor, deps: { rules?: DossierRule[] } = {}): SourceConnector {
  const rules = deps.rules ?? loadDossierRules();
  const cfg = readConfig(descriptor);
  const base = descriptor.baseUrl ?? 'https://search.dip.bundestag.de/api/v1';
  const envVar = descriptor.credentials?.envVar ?? 'DIP_API_KEY';

  function buildUrl(endpoint: string, params: Record<string, string | number | undefined>): string {
    const url = new URL(`${base}/${endpoint}`);
    url.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  return {
    descriptor,
    async fetchSince(cursor: Cursor, ctx: ConnectorContext): Promise<FetchResult> {
      const key = ctx.env(envVar);
      if (!key) {
        ctx.logger.warn(`${envVar} fehlt – DIP-Connector wird übersprungen (Lauf bleibt grün).`);
        return { items: [], nextCursor: cursor, exhausted: true };
      }
      const headers = { authorization: `ApiKey ${key}` };
      const since = (cursor.since as string | undefined) ?? undefined;
      let maxSeen = since ?? '';
      const items: FetchedItem[] = [];
      const seenVorgang = new Set<string>();

      for (const keyword of cfg.keywords) {
        if (seenVorgang.size >= cfg.maxVorgaenge) break;
        let dipCursor: string | undefined;
        for (let page = 0; page < cfg.maxPagesPerKeyword; page++) {
          const url = buildUrl('vorgang', {
            'f.wahlperiode': cfg.wahlperiode,
            'f.vorgangstyp': cfg.vorgangstyp,
            'f.titel': keyword,
            'f.aktualisiert.start': since,
            cursor: dipCursor,
          });
          let res;
          try {
            res = await ctx.http.request(url, { headers });
          } catch (err) {
            ctx.logger.warn(`DIP-Abfrage "${keyword}" fehlgeschlagen: ${(err as Error).message}`);
            break;
          }
          if (!res.ok) {
            ctx.logger.warn(`DIP /vorgang "${keyword}" → HTTP ${res.status}`);
            break;
          }
          let body: DipResponse<DipVorgang>;
          try {
            body = JSON.parse(res.text) as DipResponse<DipVorgang>;
          } catch {
            ctx.logger.warn(`DIP /vorgang "${keyword}": Antwort nicht parsebar`);
            break;
          }
          const docs = body.documents ?? [];
          for (const v of docs) {
            if (v.id === undefined || !v.titel) continue;
            const vid = String(v.id);
            if (seenVorgang.has(vid)) continue;
            if (seenVorgang.size >= cfg.maxVorgaenge) break;
            seenVorgang.add(vid);

            const match = matchDossiers(`${v.titel} ${v.abstract ?? ''} ${(v.sachgebiet ?? []).join(' ')}`, rules);
            if (match.slugs.length === 0) continue; // Relevanz-Gate

            const aktualisiert = toIso(v.aktualisiert) ?? toIso(v.datum);
            if (aktualisiert && aktualisiert > maxSeen) maxSeen = aktualisiert;
            items.push({
              externalId: `dip-vorgang-${vid}`,
              url: vorgangUrl(v),
              rawFormat: 'json',
              publishedAt: aktualisiert,
              payload: JSON.stringify({ kind: 'vorgang', vorgang: v, match }),
            });

            // Vorgangspositionen nur für relevante Vorgänge (eine Seite).
            const posUrl = buildUrl('vorgangsposition', { 'f.vorgang': vid });
            try {
              const posRes = await ctx.http.request(posUrl, { headers });
              if (posRes.ok) {
                const posBody = JSON.parse(posRes.text) as DipResponse<DipPosition>;
                for (const p of posBody.documents ?? []) {
                  if (p.id === undefined) continue;
                  items.push({
                    externalId: `dip-vp-${p.id}`,
                    url: p.fundstelle?.pdf_url ?? vorgangUrl(v),
                    rawFormat: 'json',
                    publishedAt: toIso(p.datum),
                    payload: JSON.stringify({ kind: 'vorgangsposition', position: p, vorgangId: vid, vorgangTitel: v.titel, match }),
                  });
                }
              }
            } catch (err) {
              ctx.logger.warn(`DIP /vorgangsposition (Vorgang ${vid}) fehlgeschlagen: ${(err as Error).message}`);
            }
          }
          const next = body.cursor;
          if (!next || next === dipCursor || docs.length === 0) break;
          dipCursor = next;
        }
      }

      return { items, nextCursor: { since: maxSeen || (since ?? null) }, exhausted: true };
    },

    normalize(item: FetchedItem): NormalizedInput[] {
      const data = JSON.parse(item.payload) as {
        kind: 'vorgang' | 'vorgangsposition';
        vorgang?: DipVorgang;
        position?: DipPosition;
        vorgangId?: string;
        vorgangTitel?: string;
        match: DossierMatch;
      };
      if (!data.match || data.match.slugs.length === 0) return []; // defensiv

      const common = {
        authorOrInstitution: descriptor.institution,
        dossierSlugs: data.match.slugs,
        topics: data.match.topics,
        language: 'de',
      };

      if (data.kind === 'vorgang' && data.vorgang) {
        const v = data.vorgang;
        const summaryParts = [v.beratungsstand, v.abstract].filter((s): s is string => !!s && s.trim().length > 0);
        return [
          {
            ...common,
            docType: 'vorgang',
            title: v.titel ?? '(ohne Titel)',
            externalId: item.externalId,
            publishedAt: toIso(v.aktualisiert) ?? toIso(v.datum),
            originalUrl: vorgangUrl(v),
            summary: summaryParts.join(' — ') || v.titel,
            legalReference: v.gesta ? `GESTA ${v.gesta}` : v.fundstelle?.dokumentnummer,
            meta: {
              beratungsstand: v.beratungsstand,
              vorgangstyp: v.vorgangstyp,
              wahlperiode: v.wahlperiode,
              aktualisiert: v.aktualisiert,
              matched_dossiers: data.match.slugs,
            },
          },
        ];
      }

      if (data.kind === 'vorgangsposition' && data.position) {
        const p = data.position;
        const title = [p.vorgangsposition, p.zuordnung ? `(${p.zuordnung})` : '']
          .filter(Boolean).join(' ') || 'Vorgangsposition';
        return [
          {
            ...common,
            docType: 'vorgangsposition',
            title: `${title}: ${data.vorgangTitel ?? ''}`.trim(),
            externalId: item.externalId,
            publishedAt: toIso(p.datum),
            originalUrl: p.fundstelle?.pdf_url ?? undefined,
            summary: [p.fundstelle?.dokumentart, p.fundstelle?.drucksachetyp].filter(Boolean).join(' ') || title,
            legalReference: p.fundstelle?.dokumentnummer,
            meta: { event_date: toIso(p.datum), positionstyp: p.vorgangsposition, zuordnung: p.zuordnung, vorgang_id: data.vorgangId, matched_dossiers: data.match.slugs },
          },
        ];
      }
      return [];
    },
  };
}

registerConnector('dip', (descriptor) => dipConnector(descriptor));

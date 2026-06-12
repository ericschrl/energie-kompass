const TRACKING_PARAMS = /^(utm_|pk_|piwik_|matomo_|_hs|mc_[ce]id$|gclid$|fbclid$|msclkid$|wt_mc$|icid$|cid$)/i;

/**
 * Kanonisiert URLs für die quellenübergreifende Dedup:
 * https erzwingen, Host lowercase ohne www., Tracking-Parameter raus,
 * Query sortiert, Fragment weg, Default-Ports und Trailing-Slash entfernt.
 * Die Original-URL bleibt für Zitate unangetastet erhalten.
 */
export function canonicalUrl(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed || undefined;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return trimmed;

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.port = '';
  url.hash = '';

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of params) url.searchParams.append(k, v);

  let s = url.toString();
  if (url.pathname !== '/' && url.pathname.endsWith('/') && !url.search) {
    s = s.replace(/\/$/, '');
  } else if (url.pathname === '/' && !url.search) {
    s = s.replace(/\/$/, '');
  }
  return s;
}

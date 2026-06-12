export type SourceType = 'api' | 'rss' | 'html' | 'pdf' | 'csv' | 'email' | 'manual';
export type AccessType = 'public' | 'api_key' | 'oauth' | 'private_email' | 'paywalled' | 'manual';
export type LicenceStatus = 'open' | 'public-sector' | 'cc-by' | 'unknown' | 'restricted' | 'private-use-only';
export type RawFormat = 'json' | 'xml' | 'html' | 'pdf' | 'csv' | 'eml' | 'txt';

export interface LicenceDeclaration {
  status: LicenceStatus;
  name?: string;
  url?: string;
  /** Darf normalized_text (Volltext) gespeichert werden? Wird vom Runner durchgesetzt. */
  allowsFulltextStorage: boolean;
  /** Darf Inhalt (Titel/eigene Zusammenfassung + Link) in data.js/Briefing erscheinen? */
  allowsRepublication: boolean;
  attributionRequired?: boolean;
  attributionText?: string;
}

/** Deklarative Quell-Metadaten; wird mit sources/source_licences synchronisiert. */
export interface SourceDescriptor {
  slug: string;
  name: string;
  institution: string;
  sourceType: SourceType;
  accessType: AccessType;
  baseUrl?: string;
  licence: LicenceDeclaration;
  rateLimit: { requestsPerMinute: number; minDelayMs?: number };
  credentials?: { type: 'api_key' | 'oauth_refresh_token'; envVar: string };
  defaultPolicyArea?: string;
  /** Quellspezifische Konfiguration (Feed-URLs, Filter, Queries) — nie im Code hartkodieren. */
  config?: Record<string, unknown>;
}

export type Cursor = Record<string, string | number | null>;

export interface FetchedItem {
  externalId?: string;
  url?: string;
  rawFormat: RawFormat;
  payload: string;
  publishedAt?: string;
  /** Connector-interne Zusatzinfos, die normalize() braucht. */
  hint?: Record<string, unknown>;
}

export interface FetchResult {
  items: FetchedItem[];
  nextCursor: Cursor;
  /** false => Runner ruft fetchSince() mit nextCursor erneut auf (Paginierung). */
  exhausted: boolean;
}

export interface NormalizedInput {
  docType: string;
  title: string;
  authorOrInstitution?: string;
  publishedAt?: string;
  originalUrl?: string;
  externalId?: string;
  normalizedText?: string | null;
  summary?: string;
  legalReference?: string;
  language?: string;
  policyArea?: string;
  meta?: Record<string, unknown>;
  licenceOverride?: LicenceStatus;
  entities?: Array<{
    entityType: 'person' | 'organisation' | 'gesetz' | 'paragraph' | 'fraktion' | 'unternehmen' | 'ort';
    name: string;
    normalizedName?: string;
    externalRef?: string;
  }>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  buffer: Buffer;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Conditional GET: ETag / Last-Modified aus dem Quell-Cursor. */
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
}

export interface HttpClient {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  readonly requestCount: number;
}

export interface ConnectorContext {
  http: HttpClient;
  logger: Logger;
  env(name: string): string | undefined;
  now(): Date;
}

export interface SourceConnector {
  readonly descriptor: SourceDescriptor;
  /** Eine "Seite" inkrementell ab Cursor holen. Idempotent; wirft bei harten Fehlern. */
  fetchSince(cursor: Cursor, ctx: ConnectorContext): Promise<FetchResult>;
  /** Pure function: Roh-Item -> normalisierte Dokumente (1 -> n erlaubt). Mit Fixtures testbar. */
  normalize(item: FetchedItem): NormalizedInput[];
}

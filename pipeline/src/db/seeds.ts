import { z } from 'zod';

export const LicenceSchema = z.object({
  status: z.enum(['open', 'public-sector', 'cc-by', 'unknown', 'restricted', 'private-use-only']),
  name: z.string().optional(),
  url: z.string().optional(),
  allowsFulltextStorage: z.boolean(),
  allowsRepublication: z.boolean(),
  attributionRequired: z.boolean().optional(),
  attributionText: z.string().optional(),
});

export const SourceSeedSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  institution: z.string(),
  connector: z.string().min(1),
  sourceType: z.enum(['api', 'rss', 'html', 'pdf', 'csv', 'email', 'manual']),
  accessType: z.enum(['public', 'api_key', 'oauth', 'private_email', 'paywalled', 'manual']),
  baseUrl: z.string().optional(),
  enabled: z.boolean().default(true),
  licence: LicenceSchema,
  rateLimit: z.object({ requestsPerMinute: z.number().positive(), minDelayMs: z.number().optional() }).default({ requestsPerMinute: 30 }),
  credentials: z.object({ type: z.enum(['api_key', 'oauth_refresh_token']), envVar: z.string() }).optional(),
  defaultPolicyArea: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SourceSeed = z.infer<typeof SourceSeedSchema>;
export const SourcesSeedFileSchema = z.array(SourceSeedSchema);

export const DossierSeedSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  dossierType: z.enum(['gesetzgebung_de', 'gesetzgebung_eu', 'konsultation', 'dauerthema', 'akteur']),
  status: z.enum(['aktiv', 'beobachtung', 'abgeschlossen']).default('aktiv'),
  priority: z.enum(['hoch', 'mittel', 'niedrig']).optional(),
  frontendGesetzId: z.string().optional(),
  dipVorgangId: z.string().optional(),
  euProcedureRef: z.string().optional(),
  matchRules: z
    .object({
      keywords: z.array(z.string()).default([]),
      patterns: z.array(z.string()).default([]),
      topics: z.array(z.string()).default([]),
    })
    .default({ keywords: [], patterns: [], topics: [] }),
});
export type DossierSeed = z.infer<typeof DossierSeedSchema>;
export const DossiersSeedFileSchema = z.array(DossierSeedSchema);

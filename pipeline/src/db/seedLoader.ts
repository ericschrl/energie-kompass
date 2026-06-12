import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from '../config.js';
import type { SourceDescriptor } from '../core/types.js';
import { DossiersSeedFileSchema, SourcesSeedFileSchema, type DossierSeed, type SourceSeed } from './seeds.js';

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadSourceSeeds(dir: string = config.curatedDir): SourceSeed[] {
  const file = resolve(dir, 'sources.seed.json');
  const parsed = SourcesSeedFileSchema.safeParse(readJson(file));
  if (!parsed.success) {
    throw new Error(`Ungültige ${file}: ${parsed.error.message}`);
  }
  const slugs = new Set<string>();
  for (const seed of parsed.data) {
    if (slugs.has(seed.slug)) throw new Error(`Doppelter Quellen-Slug in sources.seed.json: ${seed.slug}`);
    slugs.add(seed.slug);
  }
  return parsed.data;
}

export function loadDossierSeeds(dir: string = config.curatedDir): DossierSeed[] {
  const file = resolve(dir, 'dossiers.seed.json');
  const parsed = DossiersSeedFileSchema.safeParse(readJson(file));
  if (!parsed.success) {
    throw new Error(`Ungültige ${file}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Seed → Connector-Descriptor (Seeds aus curated/ sind die Quelle der Wahrheit). */
export function descriptorFromSeed(seed: SourceSeed): SourceDescriptor {
  return {
    slug: seed.slug,
    name: seed.name,
    institution: seed.institution,
    sourceType: seed.sourceType,
    accessType: seed.accessType,
    baseUrl: seed.baseUrl,
    licence: seed.licence,
    rateLimit: seed.rateLimit,
    credentials: seed.credentials,
    defaultPolicyArea: seed.defaultPolicyArea,
    config: seed.config,
  };
}

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PIPELINE_ROOT, '..');

const envFile = resolve(PIPELINE_ROOT, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

function intEnv(name: string, fallback: number): number {
  const v = env(name);
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env,
  dbPath: resolve(PIPELINE_ROOT, env('DB_PATH') ?? 'db/energie-kompass.db'),
  migrationsDir: resolve(PIPELINE_ROOT, 'db/migrations'),
  rawStoreDir: resolve(PIPELINE_ROOT, 'raw-store'),
  curatedDir: resolve(PIPELINE_ROOT, 'curated'),
  briefingsDir: resolve(REPO_ROOT, 'briefings'),
  dataJsPath: resolve(REPO_ROOT, 'src/data/data.js'),
  briefingsDataPath: resolve(REPO_ROOT, 'src/data/briefings.js'),
  timezone: 'Europe/Berlin',
  llm: {
    enabled: env('LLM_ENRICH') !== '0' && env('ANTHROPIC_API_KEY') !== undefined,
    apiKey: env('ANTHROPIC_API_KEY'),
    enrichModel: env('ANTHROPIC_MODEL_ENRICH') ?? 'claude-haiku-4-5-20251001',
    briefModel: env('ANTHROPIC_MODEL_BRIEF') ?? 'claude-sonnet-4-6',
    maxDocsPerRun: intEnv('LLM_MAX_DOCS_PER_RUN', 150),
  },
  // Repo/Pages sind public: private-use-only-Inhalte duerfen nie projiziert werden.
  hostingPrivate: env('HOSTING_PRIVATE') === '1',
};

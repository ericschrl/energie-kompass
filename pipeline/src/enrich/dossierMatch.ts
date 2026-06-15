import { loadDossierSeeds } from '../db/seedLoader.js';

// Gemeinsame Dossier-Matchlogik für DIP- und RSS-Connector (eine Quelle der Wahrheit).
// Rein regelbasiert (Keywords/Regex aus curated/dossiers.seed.json), kein LLM.

export type FrontendTag = 'eeg' | 'netz' | 'emob' | 'ets' | 'markt';

/** Feingranulare Dossier-Topics → fixe Frontend-Taxonomie (sonst kein Frontend-Tag). */
export const TOPIC_TO_TAG: Record<string, FrontendTag> = {
  eeg: 'eeg', 'red-iii': 'eeg',
  netz: 'netz', netzentgelte: 'netz', '14a-enwg': 'netz',
  emob: 'emob', v2g: 'emob', afir: 'emob',
  ets: 'ets',
  markt: 'markt', kraftwerksstrategie: 'markt', h2: 'markt', waerme: 'markt', speicher: 'markt',
};

export interface DossierRule {
  slug: string;
  keywords: string[];
  patterns: RegExp[];
  topics: string[];
}

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, 'iu');
  } catch {
    return null;
  }
}

export function loadDossierRules(): DossierRule[] {
  return loadDossierSeeds().map((d) => ({
    slug: d.slug,
    keywords: d.matchRules.keywords,
    patterns: d.matchRules.patterns.map((p) => safeRegex(p)).filter((r): r is RegExp => r !== null),
    topics: d.matchRules.topics,
  }));
}

export interface DossierMatch {
  slugs: string[];
  topics: Array<{ topic: string; frontendTag?: FrontendTag }>;
}

/** Liefert getroffene Dossiers + deren Topics. Leer ⇒ kein Dossier-Bezug. */
export function matchDossiers(text: string, rules: DossierRule[]): DossierMatch {
  const haystack = text.toLowerCase();
  const slugs: string[] = [];
  const topicSet = new Set<string>();
  for (const rule of rules) {
    const hitKeyword = rule.keywords.some((k) => haystack.includes(k.toLowerCase()));
    const hitPattern = rule.patterns.some((re) => re.test(text));
    if (hitKeyword || hitPattern) {
      slugs.push(rule.slug);
      for (const t of rule.topics) topicSet.add(t);
    }
  }
  return {
    slugs,
    topics: [...topicSet].map((topic) => ({ topic, frontendTag: TOPIC_TO_TAG[topic] })),
  };
}

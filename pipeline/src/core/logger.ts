import type { Logger } from './types.js';

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    info: (msg) => console.log(`${prefix} ${msg}`),
    warn: (msg) => console.warn(`${prefix} WARN ${msg}`),
    error: (msg) => console.error(`${prefix} ERROR ${msg}`),
  };
}

import type { SourceConnector, SourceDescriptor } from './types.js';

export type ConnectorFactory = (descriptor: SourceDescriptor) => SourceConnector;

const factories = new Map<string, ConnectorFactory>();

/** Connector-Implementierungen registrieren sich unter dem Namen aus sources.connector. */
export function registerConnector(name: string, factory: ConnectorFactory): void {
  factories.set(name, factory);
}

export function createConnector(name: string, descriptor: SourceDescriptor): SourceConnector {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(
      `Unbekannter Connector "${name}" (bekannt: ${[...factories.keys()].sort().join(', ') || 'keine'})`,
    );
  }
  return factory(descriptor);
}

export function knownConnectors(): string[] {
  return [...factories.keys()].sort();
}

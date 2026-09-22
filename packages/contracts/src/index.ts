export interface HealthV1 {
  service: string;
  status: 'ok' | 'unavailable';
  timestamp: string;
  dependencies?: { database: boolean; nats: boolean; jwks?: boolean };
}
/** Envelope versionado; sin eventos de negocio ni entidades persistentes. */
export interface EventEnvelopeV1<T> {
  version: 1;
  id: string;
  type: string;
  occurredAt: string;
  correlationId: string;
  payload: T;
}

export * from './auth-v1';
export * from './catalog-v1';
export * from './supplier-v1';

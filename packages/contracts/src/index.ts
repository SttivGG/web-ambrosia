export interface HealthV1 {
  service: string;
  status: 'ok' | 'unavailable';
  timestamp: string;
  dependencies?: {
    database: boolean;
    nats: boolean;
    jwks?: boolean;
    reporting?: boolean;
  };
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
export * from './purchase-v1';

export * from './production-v1';
export * from './finance-v1';
export * from './reporting-v1';

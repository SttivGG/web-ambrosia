import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ReportingController } from './reporting.controller';

const permissions = (method: keyof ReportingController) => {
  const handler = ReportingController.prototype[method];
  for (const key of Reflect.getMetadataKeys(handler))
    if (
      Array.isArray(Reflect.getMetadata(key, handler)) &&
      (Reflect.getMetadata(key, handler) as unknown[]).every(
        (value) => typeof value === 'string',
      )
    )
      return Reflect.getMetadata(key, handler) as string[];
  return [];
};

describe('RBAC de Reporting', () => {
  it('protege lectura general', () => {
    expect(permissions('inventory')).toEqual(['reports.read']);
  });
  it('restringe finanzas con permiso adicional', () => {
    expect(permissions('finance')).toEqual(['reports.read', 'reports.finance']);
  });
  it('reserva reconciliación y rebuild al permiso administrativo', () => {
    expect(permissions('reconcile')).toEqual(['reports.manage']);
    expect(permissions('rebuild')).toEqual(['reports.manage']);
  });
});

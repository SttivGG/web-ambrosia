import { afterEach, describe, expect, it, vi } from 'vitest';
import { saleStockRequestV1Schema } from '@ambrosia/contracts';
import { financeInternalAuth } from './internal.controller';
afterEach(() => vi.unstubAllEnvs());
describe('límite interno Finance–Inventory', () => {
  it('falla cerrado sin credencial y rechaza cookies', () => {
    vi.stubEnv('FINANCE_INVENTORY_TOKEN', 'a'.repeat(96));
    expect(() => financeInternalAuth(undefined, undefined)).toThrow();
    expect(() =>
      financeInternalAuth('Bearer ' + 'a'.repeat(96), 'ambrosia_access=x'),
    ).toThrow();
    expect(() =>
      financeInternalAuth('Bearer ' + 'a'.repeat(96), undefined),
    ).not.toThrow();
  });
  it('exige UUID original al anular y cantidades enteras', () => {
    const base = {
      operationId: '11111111-1111-4111-8111-111111111111',
      saleId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      reason: 'Prueba',
      lines: [
        { itemId: '44444444-4444-4444-8444-444444444444', quantity: '1.5' },
      ],
    };
    expect(
      saleStockRequestV1Schema.safeParse({ ...base, kind: 'CONFIRM' }).success,
    ).toBe(false);
    expect(
      saleStockRequestV1Schema.safeParse({
        ...base,
        kind: 'CANCEL',
        lines: [{ ...base.lines[0], quantity: '1' }],
      }).success,
    ).toBe(false);
  });
});

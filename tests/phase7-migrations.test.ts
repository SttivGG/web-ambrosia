import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('migraciones aditivas de Fase 7', () => {
  it('no infiere costo para existencias positivas preexistentes', () => {
    const sql = migration(
      'services/inventory-service/prisma/migrations/202609260002_inventory_costing/migration.sql',
    );
    expect(sql).toContain('WHERE "quantity" = 0');
    expect(sql).not.toMatch(
      /UPDATE "InventoryBalance"[\s\S]*WHERE "quantity" > 0/,
    );
    expect(sql).toContain('"inventoryValue" IS NULL');
    expect(sql).toContain('InitialInventoryValuation');
  });

  it('agrega instantáneas sin modificar tablas ni migraciones históricas', () => {
    const production = migration(
      'services/production-service/prisma/migrations/202609260003_production_cost_snapshots/migration.sql',
    );
    const finance = migration(
      'services/finance-reporting-service/prisma/migrations/202609260002_sale_cost_reporting/migration.sql',
    );
    expect(production).toContain('ADD COLUMN "bulkProductCost"');
    expect(production).toContain('ADD COLUMN "packagingMaterialsCost"');
    expect(finance).toContain('ADD COLUMN "costOfGoodsSold"');
    expect(finance).toContain('ADD COLUMN "grossMargin"');
    expect(production + finance).not.toMatch(
      /DROP TABLE|TRUNCATE|DELETE FROM/i,
    );
  });
});

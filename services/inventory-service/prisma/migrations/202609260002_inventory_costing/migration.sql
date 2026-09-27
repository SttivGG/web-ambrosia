-- Fase 7: valoración autoritativa en Inventory. Las existencias positivas
-- preexistentes permanecen deliberadamente sin valorar hasta una operación explícita.
ALTER TABLE "InventoryBalance"
  ADD COLUMN "inventoryValue" DECIMAL(48,18),
  ADD COLUMN "averageUnitCost" DECIMAL(48,18);

UPDATE "InventoryBalance"
SET "inventoryValue" = 0
WHERE "quantity" = 0;

ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_cost_state_check"
  CHECK (
    ("quantity" = 0 AND "inventoryValue" = 0 AND "averageUnitCost" IS NULL)
    OR
    ("quantity" > 0 AND "inventoryValue" IS NULL AND "averageUnitCost" IS NULL)
    OR
    ("quantity" > 0 AND "inventoryValue" >= 0 AND "averageUnitCost" >= 0)
  );

ALTER TABLE "InventoryMovement"
  ADD COLUMN "unitCost" DECIMAL(48,18),
  ADD COLUMN "totalCost" DECIMAL(48,18),
  ADD COLUMN "inventoryValueAfter" DECIMAL(48,18),
  ADD COLUMN "averageUnitCostAfter" DECIMAL(48,18);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_cost_check"
  CHECK (
    ("unitCost" IS NULL AND "totalCost" IS NULL AND "inventoryValueAfter" IS NULL AND "averageUnitCostAfter" IS NULL)
    OR
    ("unitCost" >= 0 AND "totalCost" >= 0 AND "inventoryValueAfter" >= 0)
  );

CREATE TABLE "InitialInventoryValuation" (
  "id" UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "quantity" DECIMAL(24,10) NOT NULL,
  "unitCost" DECIMAL(48,18) NOT NULL,
  "totalCost" DECIMAL(48,18) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InitialInventoryValuation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InitialInventoryValuation_positive_check"
    CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "totalCost" >= 0)
);

CREATE UNIQUE INDEX "InitialInventoryValuation_operationId_key"
  ON "InitialInventoryValuation"("operationId");
CREATE UNIQUE INDEX "InitialInventoryValuation_itemId_key"
  ON "InitialInventoryValuation"("itemId");
CREATE INDEX "InitialInventoryValuation_occurredAt_id_idx"
  ON "InitialInventoryValuation"("occurredAt", "id");
ALTER TABLE "InitialInventoryValuation"
  ADD CONSTRAINT "InitialInventoryValuation_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

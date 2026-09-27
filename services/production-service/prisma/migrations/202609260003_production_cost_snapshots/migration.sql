-- Production conserva instantáneas no autoritativas de los costos confirmados por Inventory.
ALTER TABLE "ProductionYield"
  ADD COLUMN "totalCost" DECIMAL(48,18),
  ADD COLUMN "unitCost" DECIMAL(48,18);

ALTER TABLE "PackagingOperation"
  ADD COLUMN "packagingWasteQuantity" DECIMAL(24,10) NOT NULL DEFAULT 0,
  ADD COLUMN "packagingWasteReason" VARCHAR(500),
  ADD COLUMN "bulkProductCost" DECIMAL(48,18),
  ADD COLUMN "packagingMaterialsCost" DECIMAL(48,18),
  ADD COLUMN "totalCost" DECIMAL(48,18),
  ADD COLUMN "unitCost" DECIMAL(48,18);

ALTER TABLE "ProductionYield"
  ADD CONSTRAINT "ProductionYield_cost_check"
  CHECK (("totalCost" IS NULL AND "unitCost" IS NULL) OR ("totalCost" >= 0 AND "unitCost" >= 0));
ALTER TABLE "PackagingOperation"
  ADD CONSTRAINT "PackagingOperation_waste_check"
  CHECK (("packagingWasteQuantity" = 0 AND "packagingWasteReason" IS NULL) OR ("packagingWasteQuantity" > 0 AND "packagingWasteReason" IS NOT NULL));
ALTER TABLE "PackagingOperation"
  ADD CONSTRAINT "PackagingOperation_cost_check"
  CHECK (
    ("bulkProductCost" IS NULL AND "packagingMaterialsCost" IS NULL AND "totalCost" IS NULL AND "unitCost" IS NULL)
    OR
    ("bulkProductCost" >= 0 AND "packagingMaterialsCost" >= 0 AND "totalCost" >= 0 AND "unitCost" >= 0)
  );

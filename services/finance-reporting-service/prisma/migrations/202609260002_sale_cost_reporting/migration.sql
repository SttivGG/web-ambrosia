-- Finance guarda la instantánea de costo suministrada por Inventory para reporting.
ALTER TABLE "Sale"
  ADD COLUMN "costOfGoodsSold" DECIMAL(48,18),
  ADD COLUMN "grossMargin" DECIMAL(48,18),
  ADD COLUMN "grossMarginPercent" DECIMAL(24,10);

ALTER TABLE "SaleLine"
  ADD COLUMN "unitCost" DECIMAL(48,18),
  ADD COLUMN "costSubtotal" DECIMAL(48,18);

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_cost_snapshot_check"
  CHECK (
    ("costOfGoodsSold" IS NULL AND "grossMargin" IS NULL AND "grossMarginPercent" IS NULL)
    OR
    ("costOfGoodsSold" >= 0 AND "grossMargin" IS NOT NULL AND "grossMarginPercent" IS NOT NULL)
  );
ALTER TABLE "SaleLine"
  ADD CONSTRAINT "SaleLine_cost_snapshot_check"
  CHECK (("unitCost" IS NULL AND "costSubtotal" IS NULL) OR ("unitCost" >= 0 AND "costSubtotal" >= 0));

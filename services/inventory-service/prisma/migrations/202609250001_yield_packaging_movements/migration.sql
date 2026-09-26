ALTER TYPE "MovementType" ADD VALUE 'PRODUCTION_IN';
ALTER TYPE "MovementType" ADD VALUE 'PACKAGING_OUT';
ALTER TYPE "MovementType" ADD VALUE 'PACKAGED_PRODUCT_IN';

ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_origin_check";
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_origin_check" CHECK (
 ("type" = 'PURCHASE_IN' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL) OR
 ("type" = 'REVERSAL' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL) OR
 ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AND "origin" = 'MANUAL' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NOT NULL AND "productionOperationId" IS NULL) OR
 ("type" IN ('PRODUCTION_OUT','PRODUCTION_IN','PACKAGING_OUT','PACKAGED_PRODUCT_IN') AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL) OR
 ("type" = 'PRODUCTION_RETURN' AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL));
ALTER TABLE "ProductionStockOperation" DROP CONSTRAINT "ProductionStockOperation_kind_check";
ALTER TABLE "ProductionStockOperation" ADD CONSTRAINT "ProductionStockOperation_kind_check" CHECK (
 "kind" IN ('CONSUME','REVERSE','YIELD','PACKAGE') AND ("result"->>'status') IN ('CONFIRMED','REJECTED') AND
 ("result"->>'operationId') = "id"::text AND ("result"->>'productionId') = "productionId"::text);
CREATE UNIQUE INDEX "ProductionStockOperation_confirmed_yield_key" ON "ProductionStockOperation" ("productionId") WHERE "kind"='YIELD' AND "result"->>'status'='CONFIRMED';

ALTER TYPE "MovementType" ADD VALUE 'SALE_OUT';
ALTER TYPE "MovementType" ADD VALUE 'SALE_RETURN';
ALTER TABLE "InventoryMovement" ADD COLUMN "saleOperationId" UUID;
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_origin_check";
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_origin_check" CHECK (
 ("type" = 'PURCHASE_IN' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL AND "saleOperationId" IS NULL) OR
 ("type" = 'REVERSAL' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL AND "saleOperationId" IS NULL) OR
 ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AND "origin" = 'MANUAL' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NOT NULL AND "productionOperationId" IS NULL AND "saleOperationId" IS NULL) OR
 ("type" IN ('PRODUCTION_OUT','PRODUCTION_IN','PACKAGING_OUT','PACKAGED_PRODUCT_IN') AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL AND "saleOperationId" IS NULL) OR
 ("type" = 'PRODUCTION_RETURN' AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL AND "saleOperationId" IS NULL) OR
 ("type" = 'SALE_OUT' AND "origin" = 'SALE' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL AND "saleOperationId" IS NOT NULL) OR
 ("type" = 'SALE_RETURN' AND "origin" = 'SALE' AND "purchaseLineId" IS NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL AND "saleOperationId" IS NOT NULL));
CREATE TABLE "SaleStockOperation" (
 "id" UUID NOT NULL, "saleId" UUID NOT NULL, "kind" VARCHAR(10) NOT NULL, "originalOperationId" UUID,
 "payload" JSONB NOT NULL, "result" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SaleStockOperation_pkey" PRIMARY KEY ("id"), CONSTRAINT "SaleStockOperation_kind_check" CHECK ("kind" IN ('CONFIRM','CANCEL')));
CREATE UNIQUE INDEX "SaleStockOperation_originalOperationId_key" ON "SaleStockOperation"("originalOperationId");
CREATE INDEX "SaleStockOperation_saleId_createdAt_id_idx" ON "SaleStockOperation"("saleId", "createdAt", "id");
ALTER TABLE "SaleStockOperation" ADD CONSTRAINT "SaleStockOperation_originalOperationId_fkey" FOREIGN KEY ("originalOperationId") REFERENCES "SaleStockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "InventoryMovement_saleOperationId_itemId_key" ON "InventoryMovement"("saleOperationId", "itemId");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_saleOperationId_fkey" FOREIGN KEY ("saleOperationId") REFERENCES "SaleStockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

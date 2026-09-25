-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "productionOperationId" UUID;

-- CreateTable
CREATE TABLE "ProductionStockOperation" (
    "id" UUID NOT NULL,
    "productionId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "originalOperationId" UUID,
    "payload" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionStockOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStockOperation_originalOperationId_key" ON "ProductionStockOperation"("originalOperationId");

-- CreateIndex
CREATE INDEX "ProductionStockOperation_productionId_createdAt_id_idx" ON "ProductionStockOperation"("productionId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_productionOperationId_itemId_key" ON "InventoryMovement"("productionOperationId", "itemId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productionOperationId_fkey" FOREIGN KEY ("productionOperationId") REFERENCES "ProductionStockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStockOperation" ADD CONSTRAINT "ProductionStockOperation_originalOperationId_fkey" FOREIGN KEY ("originalOperationId") REFERENCES "ProductionStockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve all legacy combinations; admit only linked production operations.
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_origin_check";
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_origin_check" CHECK (
 ("type" = 'PURCHASE_IN' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL) OR
 ("type" = 'REVERSAL' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NULL) OR
 ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AND "origin" = 'MANUAL' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NOT NULL AND "productionOperationId" IS NULL) OR
 ("type" = 'PRODUCTION_OUT' AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL) OR
 ("type" = 'PRODUCTION_RETURN' AND "origin" = 'PRODUCTION' AND "purchaseLineId" IS NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL AND "productionOperationId" IS NOT NULL));
ALTER TABLE "ProductionStockOperation" ADD CONSTRAINT "ProductionStockOperation_kind_check" CHECK ("kind" IN ('CONSUME','REVERSE') AND ("result"->>'status') IN ('CONFIRMED','REJECTED') AND ("result"->>'operationId') = "id"::text AND ("result"->>'productionId') = "productionId"::text);
CREATE UNIQUE INDEX "ProductionStockOperation_confirmed_consume_key" ON "ProductionStockOperation" ("productionId") WHERE "kind"='CONSUME' AND "result"->>'status'='CONFIRMED';

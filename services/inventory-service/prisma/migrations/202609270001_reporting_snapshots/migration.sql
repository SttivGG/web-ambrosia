ALTER TABLE "InventoryMovement" ADD COLUMN "balanceAfter" DECIMAL(24,10);
CREATE INDEX "InventoryMovement_operationId_reporting_idx" ON "InventoryMovement"("operationId") WHERE "operationId" IS NOT NULL;

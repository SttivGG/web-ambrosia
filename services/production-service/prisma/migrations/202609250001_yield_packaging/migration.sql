ALTER TYPE "ProductionOperationKind" ADD VALUE 'YIELD';
ALTER TYPE "ProductionOperationKind" ADD VALUE 'PACKAGE';
CREATE TYPE "ProductionRecordStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

CREATE TABLE "ProductionYield" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "operationId" UUID NOT NULL,
  "productId" UUID NOT NULL, "plannedQuantity" DECIMAL(24,10) NOT NULL,
  "actualQuantity" DECIMAL(24,10) NOT NULL, "differenceQuantity" DECIMAL(24,10) NOT NULL,
  "yieldPercentage" DECIMAL(24,10) NOT NULL, "wasteQuantity" DECIMAL(24,10) NOT NULL,
  "wastePercentage" DECIMAL(24,10) NOT NULL, "baseUnit" VARCHAR(20) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL, "actorId" UUID NOT NULL,
  "notes" VARCHAR(2000), "wasteReason" VARCHAR(500),
  "status" "ProductionRecordStatus" NOT NULL DEFAULT 'PENDING', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProductionYield_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PackagingOperation" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "yieldId" UUID NOT NULL, "operationId" UUID NOT NULL,
  "bulkProductId" UUID NOT NULL, "presentationProductId" UUID NOT NULL,
  "unitsPackaged" DECIMAL(24,10) NOT NULL, "productQuantityPerUnit" DECIMAL(24,10) NOT NULL,
  "productQuantityUsed" DECIMAL(24,10) NOT NULL, "baseUnit" VARCHAR(20) NOT NULL,
  "materials" JSONB NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "actorId" UUID NOT NULL,
  "notes" VARCHAR(2000), "status" "ProductionRecordStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "PackagingOperation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionYield_orderId_createdAt_id_idx" ON "ProductionYield"("orderId", "createdAt", "id");
CREATE UNIQUE INDEX "ProductionYield_active_order_key" ON "ProductionYield"("orderId") WHERE "status" IN ('PENDING','CONFIRMED');
CREATE UNIQUE INDEX "ProductionYield_operationId_key" ON "ProductionYield"("operationId");
CREATE INDEX "ProductionYield_status_occurredAt_id_idx" ON "ProductionYield"("status", "occurredAt", "id");
CREATE UNIQUE INDEX "PackagingOperation_operationId_key" ON "PackagingOperation"("operationId");
CREATE INDEX "PackagingOperation_orderId_occurredAt_id_idx" ON "PackagingOperation"("orderId", "occurredAt", "id");
CREATE INDEX "PackagingOperation_status_occurredAt_id_idx" ON "PackagingOperation"("status", "occurredAt", "id");
CREATE INDEX "PackagingOperation_presentationProductId_occurredAt_id_idx" ON "PackagingOperation"("presentationProductId", "occurredAt", "id");
ALTER TABLE "ProductionYield" ADD CONSTRAINT "ProductionYield_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionYield" ADD CONSTRAINT "ProductionYield_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagingOperation" ADD CONSTRAINT "PackagingOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagingOperation" ADD CONSTRAINT "PackagingOperation_yieldId_fkey" FOREIGN KEY ("yieldId") REFERENCES "ProductionYield"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagingOperation" ADD CONSTRAINT "PackagingOperation_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionYield" ADD CONSTRAINT "ProductionYield_values_check" CHECK (
  "plannedQuantity" > 0 AND "actualQuantity" > 0 AND "wasteQuantity" >= 0 AND
  "yieldPercentage" >= 0 AND "wastePercentage" >= 0 AND "version" > 0 AND
  "baseUnit" IN ('UNIT','GRAM','MILLILITER') AND
  (("wasteQuantity" = 0 AND "wasteReason" IS NULL) OR ("wasteQuantity" > 0 AND length(trim("wasteReason")) >= 3))
);
ALTER TABLE "PackagingOperation" ADD CONSTRAINT "PackagingOperation_values_check" CHECK (
  "unitsPackaged" > 0 AND scale("unitsPackaged") = 0 AND
  "productQuantityPerUnit" > 0 AND "productQuantityUsed" > 0 AND "version" > 0 AND
  "bulkProductId" <> "presentationProductId" AND "baseUnit" IN ('UNIT','GRAM','MILLILITER')
);

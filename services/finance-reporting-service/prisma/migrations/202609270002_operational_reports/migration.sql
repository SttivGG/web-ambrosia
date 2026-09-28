CREATE TABLE "ReportPurchaseItem" (
    "sourceService" VARCHAR(80) NOT NULL,
    "sourceEntityId" UUID NOT NULL,
    "sourceVersion" BIGINT NOT NULL,
    "operationId" UUID,
    "eventId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseId" UUID NOT NULL,
    "purchaseLineId" UUID NOT NULL,
    "purchaseReference" VARCHAR(80) NOT NULL,
    "purchasedAt" TIMESTAMPTZ(3) NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierNameSnapshot" VARCHAR(160) NOT NULL,
    "itemId" UUID NOT NULL,
    "itemNameSnapshot" VARCHAR(120) NOT NULL,
    "categoryId" UUID NOT NULL,
    "categoryNameSnapshot" VARCHAR(80) NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unitCost" DECIMAL(48,18) NOT NULL,
    "subtotal" DECIMAL(48,18) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    CONSTRAINT "ReportPurchaseItem_pkey" PRIMARY KEY ("sourceEntityId")
);
CREATE UNIQUE INDEX "ReportPurchaseItem_eventId_key" ON "ReportPurchaseItem"("eventId");
CREATE UNIQUE INDEX "ReportPurchaseItem_purchaseLineId_key" ON "ReportPurchaseItem"("purchaseLineId");
CREATE INDEX "ReportPurchaseItem_purchaseId_idx" ON "ReportPurchaseItem"("purchaseId");
CREATE INDEX "ReportPurchaseItem_supplierId_purchasedAt_idx" ON "ReportPurchaseItem"("supplierId", "purchasedAt");
CREATE INDEX "ReportPurchaseItem_itemId_purchasedAt_idx" ON "ReportPurchaseItem"("itemId", "purchasedAt");
CREATE INDEX "ReportPurchaseItem_categoryId_purchasedAt_idx" ON "ReportPurchaseItem"("categoryId", "purchasedAt");
CREATE INDEX "ReportPurchaseItem_status_purchasedAt_idx" ON "ReportPurchaseItem"("status", "purchasedAt");
CREATE INDEX "ReportPurchaseItem_operationId_idx" ON "ReportPurchaseItem"("operationId");

CREATE TABLE "ReportPackagingOperation" (
    "sourceService" VARCHAR(80) NOT NULL,
    "sourceEntityId" UUID NOT NULL,
    "sourceVersion" BIGINT NOT NULL,
    "operationId" UUID,
    "eventId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packagingOperationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "batch" VARCHAR(80) NOT NULL,
    "finishedProductId" UUID NOT NULL,
    "units" DECIMAL(24,10) NOT NULL,
    "netContentPerUnit" DECIMAL(24,10) NOT NULL,
    "netContentTotal" DECIMAL(24,10) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "bulkCost" DECIMAL(48,18),
    "materialsCost" DECIMAL(48,18),
    "totalCost" DECIMAL(48,18),
    "finishedUnitCost" DECIMAL(48,18),
    "status" VARCHAR(16) NOT NULL,
    "packagedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ReportPackagingOperation_pkey" PRIMARY KEY ("sourceEntityId")
);
CREATE UNIQUE INDEX "ReportPackagingOperation_eventId_key" ON "ReportPackagingOperation"("eventId");
CREATE UNIQUE INDEX "ReportPackagingOperation_packagingOperationId_key" ON "ReportPackagingOperation"("packagingOperationId");
CREATE INDEX "ReportPackagingOperation_batchId_packagedAt_idx" ON "ReportPackagingOperation"("batchId", "packagedAt");
CREATE INDEX "ReportPackagingOperation_finishedProductId_packagedAt_idx" ON "ReportPackagingOperation"("finishedProductId", "packagedAt");
CREATE INDEX "ReportPackagingOperation_status_packagedAt_idx" ON "ReportPackagingOperation"("status", "packagedAt");
CREATE INDEX "ReportPackagingOperation_operationId_idx" ON "ReportPackagingOperation"("operationId");

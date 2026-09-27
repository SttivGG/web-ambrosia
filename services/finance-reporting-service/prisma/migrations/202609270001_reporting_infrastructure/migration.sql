CREATE TABLE "ReportProcessedEvent" (
  "eventId" UUID NOT NULL,
  "subject" VARCHAR(80) NOT NULL,
  "sourceService" VARCHAR(80) NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "operationId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "ReportInventoryItem" (
  "sourceService" VARCHAR(80) NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "sourceVersion" BIGINT NOT NULL,
  "operationId" UUID,
  "eventId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "itemId" UUID NOT NULL,
  "itemNameSnapshot" VARCHAR(120) NOT NULL,
  "itemType" VARCHAR(32) NOT NULL,
  "unit" VARCHAR(20) NOT NULL,
  "onHand" DECIMAL(24,10) NOT NULL,
  "valuationStatus" VARCHAR(16) NOT NULL,
  "weightedAverageCost" DECIMAL(48,18),
  "inventoryValue" DECIMAL(48,18),
  "active" BOOLEAN NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReportInventoryItem_pkey" PRIMARY KEY ("sourceEntityId"),
  CONSTRAINT "ReportInventoryItem_unvalued_check" CHECK ("valuationStatus" <> 'UNVALUED' OR ("weightedAverageCost" IS NULL AND "inventoryValue" IS NULL))
);

CREATE TABLE "ReportInventoryMovement" (
  "sourceService" VARCHAR(80) NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "sourceVersion" BIGINT NOT NULL,
  "operationId" UUID,
  "eventId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "movementId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "itemNameSnapshot" VARCHAR(120) NOT NULL,
  "movementType" VARCHAR(32) NOT NULL,
  "reference" VARCHAR(120) NOT NULL,
  "quantityIn" DECIMAL(24,10) NOT NULL,
  "quantityOut" DECIMAL(24,10) NOT NULL,
  "balanceAfter" DECIMAL(24,10),
  "unitCost" DECIMAL(48,18),
  "totalCost" DECIMAL(48,18),
  "averageCostAfter" DECIMAL(48,18),
  CONSTRAINT "ReportInventoryMovement_pkey" PRIMARY KEY ("sourceEntityId")
);

CREATE TABLE "ReportProductionBatch" (
  "sourceService" VARCHAR(80) NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "sourceVersion" BIGINT NOT NULL,
  "operationId" UUID,
  "eventId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "batchId" UUID NOT NULL,
  "batch" VARCHAR(80) NOT NULL,
  "productId" UUID NOT NULL,
  "productNameSnapshot" VARCHAR(120),
  "status" VARCHAR(24) NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "inputQuantity" DECIMAL(24,10) NOT NULL,
  "outputQuantity" DECIMAL(24,10),
  "yieldPercentage" DECIMAL(24,10),
  "wasteQuantity" DECIMAL(24,10),
  "accumulatedCost" DECIMAL(48,18),
  "sellableCost" DECIMAL(48,18),
  "packagingOutputQuantity" DECIMAL(24,10),
  CONSTRAINT "ReportProductionBatch_pkey" PRIMARY KEY ("sourceEntityId")
);

CREATE TABLE "ReportSaleMargin" (
  "sourceService" VARCHAR(80) NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "sourceVersion" BIGINT NOT NULL,
  "operationId" UUID,
  "eventId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "saleId" UUID NOT NULL,
  "saleLineId" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "productId" UUID NOT NULL,
  "productNameSnapshot" VARCHAR(120) NOT NULL,
  "quantity" DECIMAL(24,10) NOT NULL,
  "revenue" DECIMAL(48,18) NOT NULL,
  "cogs" DECIMAL(48,18),
  "grossMargin" DECIMAL(48,18),
  "grossMarginPercent" DECIMAL(24,10),
  CONSTRAINT "ReportSaleMargin_pkey" PRIMARY KEY ("sourceEntityId")
);

CREATE UNIQUE INDEX "ReportInventoryItem_eventId_key" ON "ReportInventoryItem"("eventId");
CREATE UNIQUE INDEX "ReportInventoryItem_itemId_key" ON "ReportInventoryItem"("itemId");
CREATE INDEX "ReportInventoryItem_operationId_idx" ON "ReportInventoryItem"("operationId");
CREATE INDEX "ReportInventoryItem_occurredAt_idx" ON "ReportInventoryItem"("occurredAt");
CREATE INDEX "ReportInventoryItem_updatedAt_idx" ON "ReportInventoryItem"("updatedAt");
CREATE INDEX "ReportInventoryItem_itemType_valuationStatus_idx" ON "ReportInventoryItem"("itemType", "valuationStatus");
CREATE UNIQUE INDEX "ReportInventoryMovement_eventId_key" ON "ReportInventoryMovement"("eventId");
CREATE UNIQUE INDEX "ReportInventoryMovement_movementId_key" ON "ReportInventoryMovement"("movementId");
CREATE INDEX "ReportInventoryMovement_itemId_occurredAt_idx" ON "ReportInventoryMovement"("itemId", "occurredAt");
CREATE INDEX "ReportInventoryMovement_operationId_idx" ON "ReportInventoryMovement"("operationId");
CREATE INDEX "ReportInventoryMovement_occurredAt_idx" ON "ReportInventoryMovement"("occurredAt");
CREATE INDEX "ReportInventoryMovement_movementType_occurredAt_idx" ON "ReportInventoryMovement"("movementType", "occurredAt");
CREATE UNIQUE INDEX "ReportProductionBatch_eventId_key" ON "ReportProductionBatch"("eventId");
CREATE UNIQUE INDEX "ReportProductionBatch_batchId_key" ON "ReportProductionBatch"("batchId");
CREATE INDEX "ReportProductionBatch_productId_occurredAt_idx" ON "ReportProductionBatch"("productId", "occurredAt");
CREATE INDEX "ReportProductionBatch_operationId_idx" ON "ReportProductionBatch"("operationId");
CREATE INDEX "ReportProductionBatch_occurredAt_idx" ON "ReportProductionBatch"("occurredAt");
CREATE INDEX "ReportProductionBatch_status_occurredAt_idx" ON "ReportProductionBatch"("status", "occurredAt");
CREATE UNIQUE INDEX "ReportSaleMargin_eventId_key" ON "ReportSaleMargin"("eventId");
CREATE UNIQUE INDEX "ReportSaleMargin_saleLineId_key" ON "ReportSaleMargin"("saleLineId");
CREATE INDEX "ReportSaleMargin_saleId_idx" ON "ReportSaleMargin"("saleId");
CREATE INDEX "ReportSaleMargin_productId_occurredAt_idx" ON "ReportSaleMargin"("productId", "occurredAt");
CREATE INDEX "ReportSaleMargin_operationId_idx" ON "ReportSaleMargin"("operationId");
CREATE INDEX "ReportSaleMargin_occurredAt_idx" ON "ReportSaleMargin"("occurredAt");
CREATE INDEX "ReportSaleMargin_status_occurredAt_idx" ON "ReportSaleMargin"("status", "occurredAt");
CREATE INDEX "ReportProcessedEvent_sourceEntityId_idx" ON "ReportProcessedEvent"("sourceEntityId");
CREATE INDEX "ReportProcessedEvent_operationId_idx" ON "ReportProcessedEvent"("operationId");
CREATE INDEX "ReportProcessedEvent_occurredAt_idx" ON "ReportProcessedEvent"("occurredAt");
CREATE INDEX "ReportProcessedEvent_processedAt_idx" ON "ReportProcessedEvent"("processedAt");

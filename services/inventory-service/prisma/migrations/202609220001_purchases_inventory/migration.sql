-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL');

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "purchasedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(2000),
    "subtotal" DECIMAL(24,2) NOT NULL,
    "total" DECIMAL(24,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "version" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "unitCost" DECIMAL(24,2) NOT NULL,
    "subtotal" DECIMAL(24,2) NOT NULL,
    "baseUnit" "InventoryBaseUnit" NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "baseUnit" "InventoryBaseUnit" NOT NULL,
    "origin" VARCHAR(20) NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseLineId" UUID,
    "reversesId" UUID,
    "operationId" UUID,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_status_purchasedAt_id_idx" ON "Purchase"("status", "purchasedAt", "id");

-- CreateIndex
CREATE INDEX "Purchase_purchasedAt_id_idx" ON "Purchase"("purchasedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_supplierId_reference_key" ON "Purchase"("supplierId", "reference");

-- CreateIndex
CREATE INDEX "PurchaseLine_itemId_idx" ON "PurchaseLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_purchaseId_itemId_key" ON "PurchaseLine"("purchaseId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_reversesId_key" ON "InventoryMovement"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_operationId_key" ON "InventoryMovement"("operationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_occurredAt_id_idx" ON "InventoryMovement"("itemId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_occurredAt_id_idx" ON "InventoryMovement"("type", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "InventoryMovement_origin_occurredAt_id_idx" ON "InventoryMovement"("origin", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "InventoryMovement_occurredAt_id_idx" ON "InventoryMovement"("occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_purchaseLineId_type_key" ON "InventoryMovement"("purchaseLineId", "type");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive invariants: only newly created tables are constrained.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amounts_check" CHECK ("subtotal" >= 0 AND "total" = "subtotal" AND "currency" = 'COP' AND "version" > 0);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_state_check" CHECK (
 ("status" = 'DRAFT' AND "receivedAt" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL) OR
 ("status" = 'RECEIVED' AND "receivedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL) OR
 ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND length(trim("cancellationReason")) >= 3));
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_amounts_check" CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "subtotal" = round("quantity" * "unitCost", 2));
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_nonnegative_check" CHECK ("quantity" >= 0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_quantity_check" CHECK ("quantity" > 0 AND length(trim("reason")) >= 3);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_origin_check" CHECK (
 ("type" = 'PURCHASE_IN' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NULL AND "operationId" IS NULL) OR
 ("type" = 'REVERSAL' AND "origin" = 'PURCHASE' AND "purchaseLineId" IS NOT NULL AND "reversesId" IS NOT NULL AND "operationId" IS NULL) OR
 ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AND "origin" = 'MANUAL' AND "purchaseLineId" IS NULL AND "reversesId" IS NULL AND "operationId" IS NOT NULL));

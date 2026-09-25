-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionOperationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionOperationKind" AS ENUM ('CONSUME', 'REVERSE');

-- CreateTable
CREATE TABLE "Formula" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaRevision" (
    "id" UUID NOT NULL,
    "formulaId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "FormulaRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" UUID NOT NULL,
    "batch" VARCHAR(80) NOT NULL,
    "formulaRevisionId" UUID NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "ingredients" JSONB NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(2000),
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "actorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOperation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "ProductionOperationKind" NOT NULL,
    "status" "ProductionOperationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductionOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Formula_active_name_id_idx" ON "Formula"("active", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaRevision_formulaId_version_key" ON "FormulaRevision"("formulaId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_batch_key" ON "ProductionOrder"("batch");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_scheduledAt_id_idx" ON "ProductionOrder"("status", "scheduledAt", "id");

-- CreateIndex
CREATE INDEX "ProductionOperation_status_createdAt_id_idx" ON "ProductionOperation"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProductionOperation_orderId_createdAt_id_idx" ON "ProductionOperation"("orderId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "FormulaRevision" ADD CONSTRAINT "FormulaRevision_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_formulaRevisionId_fkey" FOREIGN KEY ("formulaRevisionId") REFERENCES "FormulaRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOperation" ADD CONSTRAINT "ProductionOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Formula" ADD CONSTRAINT "Formula_version_check" CHECK ("version">0 AND length(trim("name"))>0);
ALTER TABLE "FormulaRevision" ADD CONSTRAINT "FormulaRevision_version_check" CHECK ("version">0);
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_quantity_check" CHECK ("quantity">0 AND "version">0 AND length(trim("batch"))>0);
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_status_check" CHECK (
 ("status"='DRAFT' AND "startedAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR
 ("status"='IN_PROGRESS' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR
 ("status"='COMPLETED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL) OR
 ("status"='CANCELLED' AND "completedAt" IS NULL AND "cancelledAt" IS NOT NULL AND length(trim("cancellationReason"))>=3));
CREATE UNIQUE INDEX "ProductionOperation_pending_order_key" ON "ProductionOperation" ("orderId") WHERE "status"='PENDING';

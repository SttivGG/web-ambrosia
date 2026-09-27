CREATE TYPE "MoneyAccountType" AS ENUM ('CASH', 'BANK', 'OTHER');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER');
CREATE TYPE "FinanceMovementKind" AS ENUM ('ADDITIONAL_INCOME', 'EXPENSE', 'PURCHASE_PAYMENT', 'SALE_INCOME', 'SALE_REFUND');
CREATE TYPE "FinanceDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "SaleStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLATION_PENDING', 'CANCELLED');
CREATE TYPE "SaleOperationKind" AS ENUM ('CONFIRM', 'CANCEL');
CREATE TYPE "SaleOperationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
CREATE TABLE "MoneyAccount" (
 "id" UUID NOT NULL, "code" VARCHAR(40) NOT NULL, "name" VARCHAR(120) NOT NULL,
 "type" "MoneyAccountType" NOT NULL, "description" VARCHAR(500), "active" BOOLEAN NOT NULL DEFAULT true,
 "currency" VARCHAR(3) NOT NULL DEFAULT 'COP', "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 "archivedAt" TIMESTAMPTZ(3), CONSTRAINT "MoneyAccount_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MoneyAccount_currency_check" CHECK ("currency" = 'COP'));
CREATE UNIQUE INDEX "MoneyAccount_code_key" ON "MoneyAccount"("code");
CREATE INDEX "MoneyAccount_active_name_id_idx" ON "MoneyAccount"("active", "name", "id");
CREATE TABLE "Sale" (
 "id" UUID NOT NULL, "accountId" UUID NOT NULL, "status" "SaleStatus" NOT NULL DEFAULT 'PENDING',
 "subtotal" DECIMAL(24,2) NOT NULL, "total" DECIMAL(24,2) NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
 "paymentMethod" "PaymentMethod" NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "reference" VARCHAR(120),
 "description" VARCHAR(500), "actorId" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "confirmedAt" TIMESTAMPTZ(3), "cancelledAt" TIMESTAMPTZ(3), "cancellationReason" VARCHAR(500),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Sale_pkey" PRIMARY KEY ("id"), CONSTRAINT "Sale_amounts_check" CHECK ("subtotal" >= 0 AND "total" >= 0 AND "subtotal" = "total"),
 CONSTRAINT "Sale_currency_check" CHECK ("currency" = 'COP'));
CREATE INDEX "Sale_status_occurredAt_id_idx" ON "Sale"("status", "occurredAt", "id");
CREATE INDEX "Sale_reference_idx" ON "Sale"("reference");
CREATE TABLE "SaleLine" (
 "id" UUID NOT NULL, "saleId" UUID NOT NULL, "itemId" UUID NOT NULL, "sku" VARCHAR(40) NOT NULL,
 "name" VARCHAR(120) NOT NULL, "quantity" INTEGER NOT NULL, "unitPrice" DECIMAL(24,2) NOT NULL,
 "subtotal" DECIMAL(24,2) NOT NULL, CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SaleLine_values_check" CHECK ("quantity" > 0 AND "unitPrice" > 0 AND "subtotal" > 0));
CREATE UNIQUE INDEX "SaleLine_saleId_itemId_key" ON "SaleLine"("saleId", "itemId");
CREATE INDEX "SaleLine_itemId_idx" ON "SaleLine"("itemId");
CREATE TABLE "SaleOperation" (
 "id" UUID NOT NULL, "saleId" UUID NOT NULL, "kind" "SaleOperationKind" NOT NULL,
 "status" "SaleOperationStatus" NOT NULL DEFAULT 'PENDING', "payload" JSONB NOT NULL, "result" JSONB,
 "error" VARCHAR(500), "originalOperationId" UUID, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "SaleOperation_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "SaleOperation_originalOperationId_key" ON "SaleOperation"("originalOperationId");
CREATE INDEX "SaleOperation_status_updatedAt_id_idx" ON "SaleOperation"("status", "updatedAt", "id");
CREATE INDEX "SaleOperation_saleId_createdAt_id_idx" ON "SaleOperation"("saleId", "createdAt", "id");
CREATE TABLE "FinanceMovement" (
 "id" UUID NOT NULL, "operationId" UUID NOT NULL, "accountId" UUID NOT NULL, "kind" "FinanceMovementKind" NOT NULL,
 "direction" "FinanceDirection" NOT NULL, "amount" DECIMAL(24,2) NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
 "status" VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED', "paymentMethod" "PaymentMethod" NOT NULL,
 "occurredAt" TIMESTAMPTZ(3) NOT NULL, "reference" VARCHAR(120), "description" VARCHAR(500) NOT NULL,
 "actorId" UUID NOT NULL, "saleId" UUID, "reversesId" UUID, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceMovement_pkey" PRIMARY KEY ("id"), CONSTRAINT "FinanceMovement_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "FinanceMovement_confirmed_check" CHECK ("status" = 'CONFIRMED'), CONSTRAINT "FinanceMovement_currency_check" CHECK ("currency" = 'COP'));
CREATE UNIQUE INDEX "FinanceMovement_operationId_key" ON "FinanceMovement"("operationId");
CREATE UNIQUE INDEX "FinanceMovement_reversesId_key" ON "FinanceMovement"("reversesId");
CREATE INDEX "FinanceMovement_accountId_occurredAt_id_idx" ON "FinanceMovement"("accountId", "occurredAt", "id");
CREATE INDEX "FinanceMovement_kind_occurredAt_id_idx" ON "FinanceMovement"("kind", "occurredAt", "id");
CREATE INDEX "FinanceMovement_saleId_idx" ON "FinanceMovement"("saleId");
CREATE TABLE "PurchasePayment" (
 "id" UUID NOT NULL, "operationId" UUID NOT NULL, "purchaseId" UUID NOT NULL, "accountId" UUID NOT NULL,
 "movementId" UUID NOT NULL, "amount" DECIMAL(24,2) NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
 "paymentMethod" "PaymentMethod" NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "reference" VARCHAR(120),
 "description" VARCHAR(500), "actorId" UUID NOT NULL, "purchaseSnapshot" JSONB NOT NULL,
 "discrepancy" BOOLEAN NOT NULL DEFAULT false, "discrepancyReason" VARCHAR(500), "checkedAt" TIMESTAMPTZ(3),
 "regularizedAt" TIMESTAMPTZ(3), "regularizedBy" UUID, "regularizationNote" VARCHAR(500),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PurchasePayment_amount_check" CHECK ("amount" > 0), CONSTRAINT "PurchasePayment_currency_check" CHECK ("currency" = 'COP'));
CREATE UNIQUE INDEX "PurchasePayment_operationId_key" ON "PurchasePayment"("operationId");
CREATE UNIQUE INDEX "PurchasePayment_movementId_key" ON "PurchasePayment"("movementId");
CREATE INDEX "PurchasePayment_purchaseId_occurredAt_id_idx" ON "PurchasePayment"("purchaseId", "occurredAt", "id");
CREATE INDEX "PurchasePayment_discrepancy_occurredAt_id_idx" ON "PurchasePayment"("discrepancy", "occurredAt", "id");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleOperation" ADD CONSTRAINT "SaleOperation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleOperation" ADD CONSTRAINT "SaleOperation_originalOperationId_fkey" FOREIGN KEY ("originalOperationId") REFERENCES "SaleOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "FinanceMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "FinanceMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

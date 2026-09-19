-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'PACKAGING', 'FINISHED_PRODUCT', 'BYPRODUCT', 'SUPPLY');

-- CreateEnum
CREATE TYPE "InventoryBaseUnit" AS ENUM ('UNIT', 'GRAM', 'MILLILITER');

-- CreateEnum
CREATE TYPE "OperationUnit" AS ENUM ('UNIT', 'GRAM', 'KILOGRAM', 'MILLILITER', 'LITER');

-- CreateEnum
CREATE TYPE "NominalCapacityUnit" AS ENUM ('MILLILITER', 'FLUID_OUNCE', 'GRAM');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "normalizedSku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(240) NOT NULL,
    "description" VARCHAR(2000),
    "itemType" "ItemType" NOT NULL,
    "categoryId" UUID NOT NULL,
    "inventoryBaseUnit" "InventoryBaseUnit" NOT NULL,
    "defaultOperationUnit" "OperationUnit" NOT NULL,
    "nominalCapacityValue" DECIMAL(24,10),
    "nominalCapacityUnit" "NominalCapacityUnit",
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "minimumStockBase" DECIMAL(24,10),
    "barcode" VARCHAR(80),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_normalizedName_key" ON "Category"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_active_name_id_idx" ON "Category"("active", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_sku_key" ON "CatalogItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_normalizedSku_key" ON "CatalogItem"("normalizedSku");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_barcode_key" ON "CatalogItem"("barcode");

-- CreateIndex
CREATE INDEX "CatalogItem_categoryId_active_idx" ON "CatalogItem"("categoryId", "active");

-- CreateIndex
CREATE INDEX "CatalogItem_active_name_id_idx" ON "CatalogItem"("active", "name", "id");

-- CreateIndex
CREATE INDEX "CatalogItem_itemType_inventoryBaseUnit_idx" ON "CatalogItem"("itemType", "inventoryBaseUnit");

-- CreateIndex
CREATE INDEX "CatalogItem_normalizedName_idx" ON "CatalogItem"("normalizedName");

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that PostgreSQL can enforce independently of HTTP.
ALTER TABLE "Category" ADD CONSTRAINT "Category_valid" CHECK (length(btrim("name")) BETWEEN 2 AND 80 AND "version" >= 1 AND "active" = ("archivedAt" IS NULL));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_valid" CHECK (length(btrim("name")) BETWEEN 2 AND 120 AND "version" >= 1 AND "active" = ("archivedAt" IS NULL) AND "sku" ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$' AND "normalizedSku" = "sku" AND ("barcode" IS NULL OR length(btrim("barcode")) > 0));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_units" CHECK (("inventoryBaseUnit" = 'UNIT' AND "defaultOperationUnit" = 'UNIT') OR ("inventoryBaseUnit" = 'GRAM' AND "defaultOperationUnit" IN ('GRAM','KILOGRAM')) OR ("inventoryBaseUnit" = 'MILLILITER' AND "defaultOperationUnit" IN ('MILLILITER','LITER')));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_type_units" CHECK (("itemType" <> 'PACKAGING' OR "inventoryBaseUnit" = 'UNIT') AND ("itemType" <> 'BYPRODUCT' OR "inventoryBaseUnit" <> 'UNIT'));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_capacity" CHECK (("nominalCapacityValue" IS NULL AND "nominalCapacityUnit" IS NULL) OR ("nominalCapacityValue" IS NOT NULL AND "nominalCapacityValue" > 0 AND "nominalCapacityUnit" IS NOT NULL));
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_minimum" CHECK ("minimumStockBase" IS NULL OR "minimumStockBase" >= 0);

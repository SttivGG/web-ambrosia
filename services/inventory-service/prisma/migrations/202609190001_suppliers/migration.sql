CREATE TABLE "Supplier" (
 "id" UUID NOT NULL, "code" VARCHAR(40) NOT NULL, "name" VARCHAR(160) NOT NULL,
 "tradeName" VARCHAR(160), "identificationType" VARCHAR(20), "identificationNumber" VARCHAR(40), "normalizedIdentification" VARCHAR(40),
 "contactName" VARCHAR(120), "email" VARCHAR(254), "phone" VARCHAR(40), "address" VARCHAR(240), "municipality" VARCHAR(100), "department" VARCHAR(100), "notes" VARCHAR(2000),
 "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "archivedAt" TIMESTAMPTZ(3),
 CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "Supplier_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
 CONSTRAINT "Supplier_name_check" CHECK (length(trim("name")) >= 2),
 CONSTRAINT "Supplier_version_check" CHECK ("version" > 0),
 CONSTRAINT "Supplier_state_check" CHECK ("active" = ("archivedAt" IS NULL)),
 CONSTRAINT "Supplier_identification_check" CHECK (
   ("identificationType" IS NULL AND "identificationNumber" IS NULL AND "normalizedIdentification" IS NULL) OR
   ("identificationType" IS NOT NULL AND "identificationType" IN ('NIT','CC','CE','PASSPORT','OTHER') AND "identificationNumber" IS NOT NULL AND "normalizedIdentification" IS NOT NULL AND length("normalizedIdentification") > 0 AND "normalizedIdentification" = upper(regexp_replace(trim("identificationNumber"), '[ .-]', '', 'g')))
 )
);
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE UNIQUE INDEX "Supplier_identificationType_normalizedIdentification_key" ON "Supplier"("identificationType", "normalizedIdentification");
CREATE INDEX "Supplier_active_name_id_idx" ON "Supplier"("active", "name", "id");
CREATE TABLE "SupplierItem" (
 "supplierId" UUID NOT NULL, "itemId" UUID NOT NULL,
 CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("supplierId", "itemId"),
 CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupplierItem_itemId_idx" ON "SupplierItem"("itemId");

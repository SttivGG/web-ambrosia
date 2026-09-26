ALTER TABLE "PackagingOperation"
  DROP CONSTRAINT "PackagingOperation_values_check";

ALTER TABLE "PackagingOperation"
  ADD CONSTRAINT "PackagingOperation_values_check" CHECK (
    "unitsPackaged" > 0 AND "unitsPackaged" = trunc("unitsPackaged") AND
    "productQuantityPerUnit" > 0 AND "productQuantityUsed" > 0 AND "version" > 0 AND
    "bulkProductId" <> "presentationProductId" AND "baseUnit" IN ('UNIT','GRAM','MILLILITER')
  );

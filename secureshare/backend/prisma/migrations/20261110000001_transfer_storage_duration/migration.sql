ALTER TABLE "Transfer"
  ADD COLUMN "fileCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storageDurationDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "uploadedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "Transfer"
SET "uploadedAt" = "createdAt"
WHERE "status" = 'ACTIVE' AND "uploadedAt" IS NULL;

UPDATE "Transfer"
SET "fileCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "TransferFile"
  WHERE "TransferFile"."transferId" = "Transfer"."id"
)
WHERE "fileCount" = 0;

UPDATE "Transfer"
SET "downloadCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "DownloadRecord"
  WHERE "DownloadRecord"."transferId" = "Transfer"."id"
)
WHERE "downloadCount" = 0;

ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_storageDurationDays_check"
  CHECK ("storageDurationDays" IN (1, 3, 5, 10));
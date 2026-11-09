-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('UPLOADING', 'ACTIVE', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('AVAILABLE', 'REQUESTED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(191) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL,
    "senderUserId" UUID,
    "ownerTokenHash" CHAR(64) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'UPLOADING',
    "encryptedKeyEnvelope" TEXT,
    "encryptedMetadata" TEXT,
    "opaqueRegistration" TEXT,
    "totalSize" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferCode" (
    "id" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "transferId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferFile" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "originalSize" INTEGER NOT NULL,
    "encryptedSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "downloadStatus" "DownloadStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "TransferFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadRecord" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DownloadRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Transfer_status_expiresAt_idx" ON "Transfer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferCode_codeHash_key" ON "TransferCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "TransferCode_transferId_key" ON "TransferCode"("transferId");

-- CreateIndex
CREATE INDEX "TransferCode_expiresAt_idx" ON "TransferCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferFile_objectKey_key" ON "TransferFile"("objectKey");

-- CreateIndex
CREATE INDEX "TransferFile_transferId_idx" ON "TransferFile"("transferId");

-- CreateIndex
CREATE INDEX "DownloadRecord_transferId_createdAt_idx" ON "DownloadRecord"("transferId", "createdAt");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferCode" ADD CONSTRAINT "TransferCode_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferFile" ADD CONSTRAINT "TransferFile_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadRecord" ADD CONSTRAINT "DownloadRecord_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

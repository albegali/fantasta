-- CreateEnum
CREATE TYPE "ReleaseRefund" AS ENUM ('none', 'purchase', 'quotation', 'average');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuctionLogType" ADD VALUE 'REPAIR_START';
ALTER TYPE "AuctionLogType" ADD VALUE 'RELEASE';
ALTER TYPE "AuctionLogType" ADD VALUE 'UNRELEASE';

-- AlterEnum
ALTER TYPE "AuctionStatus" ADD VALUE 'RELEASING';

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "releaseRefund" "ReleaseRefund" NOT NULL DEFAULT 'purchase',
ADD COLUMN     "repairRound" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "creditAdjustment" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "refund" INTEGER NOT NULL,
    "nominatedById" TEXT,
    "repairRound" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Release_participantId_idx" ON "Release"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Release_leagueId_playerId_repairRound_key" ON "Release"("leagueId", "playerId", "repairRound");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

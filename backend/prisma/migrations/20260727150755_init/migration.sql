-- CreateEnum
CREATE TYPE "Role" AS ENUM ('P', 'D', 'C', 'A');

-- CreateEnum
CREATE TYPE "CallOrder" AS ENUM ('fixed', 'free');

-- CreateEnum
CREATE TYPE "StartPriceMode" AS ENUM ('fixed', 'quotation');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('IDLE', 'BIDDING', 'ASSIGNED', 'PAUSED', 'FILLING', 'FINISHED');

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL DEFAULT 'La mia lega',
    "auctionName" TEXT NOT NULL DEFAULT 'Asta',
    "budget" INTEGER NOT NULL DEFAULT 300,
    "slotsP" INTEGER NOT NULL DEFAULT 3,
    "slotsD" INTEGER NOT NULL DEFAULT 8,
    "slotsC" INTEGER NOT NULL DEFAULT 8,
    "slotsA" INTEGER NOT NULL DEFAULT 6,
    "callOrder" "CallOrder" NOT NULL DEFAULT 'fixed',
    "bidTimerSeconds" INTEGER NOT NULL DEFAULT 5,
    "startPriceMode" "StartPriceMode" NOT NULL DEFAULT 'fixed',
    "startPrice" INTEGER NOT NULL DEFAULT 1,
    "turnOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "closedRoles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "status" "AuctionStatus" NOT NULL DEFAULT 'IDLE',
    "lastImportName" TEXT,
    "lastImportAt" TIMESTAMP(3),
    "lastImportCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "color" TEXT,
    "accessCode" TEXT NOT NULL,
    "budget" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "externalId" INTEGER,
    "name" TEXT NOT NULL,
    "realTeam" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "quotation" INTEGER NOT NULL DEFAULT 1,
    "fvm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acquisition" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Acquisition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_leagueId_accessCode_key" ON "Participant"("leagueId", "accessCode");

-- CreateIndex
CREATE UNIQUE INDEX "Player_externalId_key" ON "Player"("externalId");

-- CreateIndex
CREATE INDEX "Player_role_idx" ON "Player"("role");

-- CreateIndex
CREATE INDEX "Player_quotation_idx" ON "Player"("quotation");

-- CreateIndex
CREATE UNIQUE INDEX "Player_name_realTeam_key" ON "Player"("name", "realTeam");

-- CreateIndex
CREATE INDEX "Acquisition_participantId_idx" ON "Acquisition"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Acquisition_leagueId_playerId_key" ON "Acquisition"("leagueId", "playerId");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquisition" ADD CONSTRAINT "Acquisition_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquisition" ADD CONSTRAINT "Acquisition_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquisition" ADD CONSTRAINT "Acquisition_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

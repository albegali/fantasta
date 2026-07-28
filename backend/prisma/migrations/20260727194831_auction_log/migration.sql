-- CreateEnum
CREATE TYPE "AuctionLogType" AS ENUM ('START', 'NOMINATE', 'BID', 'ASSIGNED', 'CLAIM', 'MANUAL', 'REOPEN', 'SKIP', 'ROLE_CLOSED', 'PAUSE', 'RESUME', 'FILLING', 'FINISHED', 'RESET');

-- CreateTable
CREATE TABLE "AuctionLogEntry" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "AuctionLogType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "participantId" TEXT,
    "teamName" TEXT,
    "playerId" INTEGER,
    "playerName" TEXT,
    "role" "Role",
    "price" INTEGER,
    "detail" TEXT,

    CONSTRAINT "AuctionLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuctionLogEntry_leagueId_type_idx" ON "AuctionLogEntry"("leagueId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionLogEntry_leagueId_seq_key" ON "AuctionLogEntry"("leagueId", "seq");

-- AddForeignKey
ALTER TABLE "AuctionLogEntry" ADD CONSTRAINT "AuctionLogEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

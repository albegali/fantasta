-- Magic link dei partecipanti: credenziale lunga per squadra + generazione delle
-- credenziali per la revoca dei JWT di sessione (vedi PLAN.md, decisione 21).
--
-- `magicToken` è NOT NULL nello schema, ma qui arriva su righe che esistono già:
-- si aggiunge nullable, si fa il backfill e solo dopo si stringe il vincolo.

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN "magicToken" TEXT;
ALTER TABLE "Participant" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Backfill: 32 caratteri esadecimali (128 bit) per riga. `gen_random_uuid()` è
-- nel core di PostgreSQL da 13. I token generati dall'app sono base64url, ma qui
-- conta solo che siano unici e non indovinabili.
UPDATE "Participant"
SET "magicToken" = replace(gen_random_uuid()::text, '-', '')
WHERE "magicToken" IS NULL;

ALTER TABLE "Participant" ALTER COLUMN "magicToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Participant_magicToken_key" ON "Participant"("magicToken");

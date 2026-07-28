import { randomBytes, randomInt } from 'node:crypto';
import { League, PrismaClient } from '@prisma/client';
import { AuctionRules } from '../auction/dto/events';

/**
 * Helper puri sulla lega, condivisi fra `rules` e `auction` **senza** creare una
 * dipendenza fra i due moduli (che sarebbe circolare: le rotte REST notificano
 * l'AuctionService, non viceversa).
 */

/** Ritorna la lega, creando quella di default se il DB è vuoto. */
export async function ensureLeague(prisma: PrismaClient): Promise<League> {
  const existing = await prisma.league.findFirst({ orderBy: { createdAt: 'asc' } });
  return existing ?? prisma.league.create({ data: {} });
}

/** Riga `League` → `AuctionRules` del contratto socket. */
export function toAuctionRules(league: League): AuctionRules {
  return {
    leagueName: league.leagueName,
    auctionName: league.auctionName,
    budget: league.budget,
    rosterSlots: {
      P: league.slotsP,
      D: league.slotsD,
      C: league.slotsC,
      A: league.slotsA,
    },
    callOrder: league.callOrder,
    bidTimerSeconds: league.bidTimerSeconds,
    startPriceMode: league.startPriceMode,
    startPrice: league.startPrice,
    releaseRefund: league.releaseRefund,
  };
}

/** Alfabeto senza caratteri ambigui (0/O, 1/I): i codici si dettano a voce. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomAccessCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Credenziale del magic link: 24 byte casuali in base64url, 32 caratteri che
 * stanno in un URL senza escaping. È un segreto vero — a differenza del codice a
 * 6 caratteri non si detta a voce, si manda su WhatsApp — quindi arriva da
 * `randomBytes` e non da `Math.random`.
 */
export function randomMagicToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Colori identità squadra (token Nocturne del design system). */
const TEAM_COLORS = [
  '#b5abfc',
  '#9397ab',
  '#a7a1db',
  '#cfd3e5',
  '#968ae0',
  '#b2b6ca',
  '#d2cefd',
  '#7972a9',
];

export function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}

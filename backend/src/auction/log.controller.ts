import { Controller, Get, Query } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { LOG_TYPES, PURCHASE_TYPES } from './auction-log.service';
import { AuctionLogEntry, AuctionLogType } from './dto/events';

/** Alias comodo a voce e in `curl`: le sole righe d'acquisto. */
const PURCHASES_ALIAS = 'purchases';

/**
 * Telecronaca dell'asta, la più recente in testa. In sola lettura e **pubblica**
 * come `/players` e `/participants`: la cronaca è quel che tutti hanno visto in
 * sala, e non contiene codici d'accesso.
 *
 * Vive nell'`AuctionModule` perché il log è parte del dominio d'asta: chi scrive è
 * `AuctionService`, e un modulo REST a parte dovrebbe importarlo (AGENTS.md
 * §"Direzione delle dipendenze"). Lo snapshot socket porta solo la **coda**
 * recente (`LOG_TAIL`): la storia intera si chiede qui.
 *
 *   GET /log?take=200&before=340&type=purchases&participantId=…
 */
@Controller('log')
export class LogController {
  constructor(private readonly auction: AuctionService) {}

  @Get()
  list(
    @Query('take') take?: string,
    @Query('before') before?: string,
    @Query('type') type?: string,
    @Query('participantId') participantId?: string,
  ): Promise<AuctionLogEntry[]> {
    return this.auction.history({
      take: toInt(take),
      before: toInt(before),
      types: parseTypes(type),
      participantId: participantId?.trim() || undefined,
    });
  }
}

function toInt(value?: string): number | undefined {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isNaN(n) ? undefined : n;
}

/** `type=purchases` oppure una lista `type=nominate,bid`. Ignora i nomi che non esistono. */
function parseTypes(value?: string): AuctionLogType[] | undefined {
  if (!value?.trim()) return undefined;
  const wanted = value.split(',').flatMap((raw) => {
    const name = raw.trim();
    if (name === PURCHASES_ALIAS) return [...PURCHASE_TYPES];
    return LOG_TYPES.includes(name as AuctionLogType) ? [name as AuctionLogType] : [];
  });
  return wanted.length ? [...new Set(wanted)] : undefined;
}

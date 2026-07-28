import { Injectable, Logger } from '@nestjs/common';
import { AuctionLogType as DbLogType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionLogEntry, AuctionLogType, LOG_TAIL, Role } from './dto/events';

/** Una riga di telecronaca prima che le venga dato il suo numero. */
export type LogDraft = Omit<AuctionLogEntry, 'seq' | 'at'> & { at?: number };

export interface LogQuery {
  /** Quante righe, a partire dalla più recente. */
  take?: number;
  /** Cursore: solo le righe **precedenti** a questo `seq` (esclusivo). */
  before?: number;
  /** Filtro per tipo; vuoto = tutti. */
  types?: AuctionLogType[];
  participantId?: string;
}

/** Contratto (camelCase) ⇄ enum Prisma (SCREAMING_CASE). */
const TO_DB: Record<AuctionLogType, DbLogType> = {
  start: 'START',
  nominate: 'NOMINATE',
  bid: 'BID',
  assigned: 'ASSIGNED',
  claim: 'CLAIM',
  manual: 'MANUAL',
  reopen: 'REOPEN',
  skip: 'SKIP',
  roleClosed: 'ROLE_CLOSED',
  pause: 'PAUSE',
  resume: 'RESUME',
  filling: 'FILLING',
  finished: 'FINISHED',
  reset: 'RESET',
  repairStart: 'REPAIR_START',
  release: 'RELEASE',
  unrelease: 'UNRELEASE',
};

const FROM_DB = Object.fromEntries(Object.entries(TO_DB).map(([k, v]) => [v, k])) as Record<
  DbLogType,
  AuctionLogType
>;

/** Tutti i tipi validi, presi dalla mappa: un elenco in più si dimenticherebbe. */
export const LOG_TYPES = Object.keys(TO_DB) as AuctionLogType[];

/** Righe che raccontano un acquisto: il filtro "chi ha comprato cosa e a quanto". */
export const PURCHASE_TYPES: readonly AuctionLogType[] = ['assigned', 'claim', 'manual'] as const;

export const LOG_PAGE = 200;

/**
 * Telecronaca dell'asta: chi ha chiamato, chi ha rilanciato, chi ha comprato cosa
 * e a quanto. Giornale **append-only** — un lotto riaperto non riscrive la riga
 * della vendita, ne aggiunge una che la spiega.
 *
 * Due scelte che vale la pena conoscere prima di toccare questo file:
 *
 * 1. **La scrittura non blocca l'asta.** `append()` è sincrona: assegna il `seq`,
 *    aggiorna la coda in memoria e mette l'INSERT in una **sua** coda FIFO. Il
 *    rilancio è la strada calda dell'asta (`AuctionService.bid`, dentro il mutex
 *    della lega) e non deve aspettare un round-trip al DB — su tier gratuito sono
 *    decine di millisecondi per riga. Se l'INSERT fallisce, si perde una riga di
 *    cronaca: l'asta no.
 * 2. **`seq` lo assegna il processo**, non un autoincrement: la riga deve avere il
 *    suo numero prima che il DB risponda. `clear()` passa dalla stessa coda, così
 *    l'azzeramento non scavalca le scritture ancora in volo (che altrimenti
 *    sopravvivrebbero al reset, o sbatterebbero sul vincolo `(leagueId, seq)`).
 */
@Injectable()
export class AuctionLogService {
  private readonly log = new Logger(AuctionLogService.name);

  private seq = 0;
  /** Coda recente, la più nuova in testa: è quel che finisce in `AuctionState.log`. */
  private recent: AuctionLogEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  /** Riallinea `seq` e coda recente al DB. Chiamata al boot dell'asta. */
  async load(leagueId: string): Promise<AuctionLogEntry[]> {
    const rows = await this.prisma.auctionLogEntry.findMany({
      where: { leagueId },
      orderBy: { seq: 'desc' },
      take: LOG_TAIL,
    });
    this.recent = rows.map(toEntry);
    this.seq = this.recent[0]?.seq ?? 0;
    return this.tail();
  }

  /** La coda recente, più nuova in testa. Copia: lo snapshot non deve poterla mutare. */
  tail(): AuctionLogEntry[] {
    return [...this.recent];
  }

  /**
   * Aggiunge una riga e ritorna la **nuova coda** da mettere nello snapshot.
   * Non attende il DB (vedi nota 1 in testa al file) e non lancia mai: una riga
   * di cronaca non vale il fallimento di un'assegnazione.
   */
  append(leagueId: string, draft: LogDraft): AuctionLogEntry[] {
    this.seq += 1;
    const entry: AuctionLogEntry = { ...draft, seq: this.seq, at: draft.at ?? Date.now() };
    this.recent = [entry, ...this.recent].slice(0, LOG_TAIL);
    this.enqueue(() =>
      this.prisma.auctionLogEntry.create({ data: toRow(leagueId, entry) }).then(() => undefined),
    );
    return this.tail();
  }

  /** Storia completa, la più recente in testa. Paginata con `before` (cursore su `seq`). */
  async list(leagueId: string, query: LogQuery = {}): Promise<AuctionLogEntry[]> {
    const where: Prisma.AuctionLogEntryWhereInput = { leagueId };
    if (query.before !== undefined) where.seq = { lt: query.before };
    if (query.types?.length) where.type = { in: query.types.map((t) => TO_DB[t]) };
    if (query.participantId) where.participantId = query.participantId;
    const rows = await this.prisma.auctionLogEntry.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: Math.min(Math.max(query.take ?? LOG_PAGE, 1), 1000),
    });
    return rows.map(toEntry);
  }

  /** Reset asta: la cronaca della partita vecchia non serve più. */
  clear(leagueId: string): Promise<void> {
    this.seq = 0;
    this.recent = [];
    return this.enqueue(() =>
      this.prisma.auctionLogEntry.deleteMany({ where: { leagueId } }).then(() => undefined),
    );
  }

  /** Attende le scritture in volo. Serve ai test e a uno spegnimento pulito. */
  flush(): Promise<unknown> {
    return this.queue;
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn, fn).catch((e: Error) => {
      // Perdere una riga di cronaca è un peccato, non un incidente: si annota e si va avanti.
      this.log.warn(`Riga di telecronaca non salvata: ${e.message}`);
    });
    this.queue = next;
    return next;
  }
}

function toEntry(row: {
  seq: number;
  type: DbLogType;
  at: Date;
  participantId: string | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  role: Role | null;
  price: number | null;
  detail: string | null;
}): AuctionLogEntry {
  return {
    seq: row.seq,
    type: FROM_DB[row.type],
    at: row.at.getTime(),
    participantId: row.participantId,
    teamName: row.teamName,
    playerId: row.playerId,
    playerName: row.playerName,
    role: row.role,
    price: row.price,
    detail: row.detail,
  };
}

function toRow(
  leagueId: string,
  entry: AuctionLogEntry,
): Prisma.AuctionLogEntryUncheckedCreateInput {
  return {
    leagueId,
    seq: entry.seq,
    type: TO_DB[entry.type],
    at: new Date(entry.at),
    participantId: entry.participantId,
    teamName: entry.teamName,
    playerId: entry.playerId,
    playerName: entry.playerName,
    role: entry.role,
    price: entry.price,
    detail: entry.detail,
  };
}

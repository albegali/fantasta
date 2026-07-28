import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuctionService } from '../auction/auction.service';
import { PlayerRow, Role as RoleKey } from '../auction/dto/events';
import { PrismaService } from '../prisma/prisma.service';
import { ensureLeague } from '../rules/league.util';
import { parseFantacalcioXlsx, ParsedPlayer } from './fantacalcio-xlsx.parser';

export interface ImportResult {
  imported: number;
  updated: number;
  total: number;
}

export interface LastImport {
  filename: string;
  at: string;
  count: number;
}

export interface PlayerQuery {
  q?: string;
  role?: RoleKey;
  onlyAvailable?: boolean;
  /** Solo i già assegnati: serve alla Regia per riaprire un lotto. */
  onlyTaken?: boolean;
  take?: number;
}

/** Tetto duro sul `take`: la tab Listone chiede 1000 righe, non serve di più. */
const MAX_TAKE = 2000;
const DEFAULT_TAKE = 50;

@Injectable()
export class PlayersService {
  private readonly log = new Logger(PlayersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auction: AuctionService,
  ) {}

  /**
   * Ricerca per l'autocomplete di chiamata e per la tab Listone. **Ordinata per
   * quotazione decrescente**: `take` deve dare i più quotati, non i primi che
   * capitano (frontend/README.md §"La lista di chiamata la filtra il server").
   */
  async list(query: PlayerQuery): Promise<PlayerRow[]> {
    const take = Math.min(Math.max(query.take ?? DEFAULT_TAKE, 1), MAX_TAKE);
    const q = query.q?.trim();
    const where: Prisma.PlayerWhereInput = {};
    if (query.role) where.role = query.role as Role;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { realTeam: { contains: q, mode: 'insensitive' } },
      ];
    }
    // `available` e `taken` sono l'uno il complemento dell'altro: se arrivano
    // entrambi vince `available`, così una query contraddittoria non svuota il DB
    // di significato ritornando zero righe senza spiegazione.
    if (query.onlyAvailable) where.acquisitions = { none: {} };
    else if (query.onlyTaken) where.acquisitions = { some: {} };

    const rows = await this.prisma.player.findMany({
      where,
      orderBy: [{ quotation: 'desc' }, { name: 'asc' }],
      take,
    });
    const taken = await this.auction.takenPlayerIds();
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.realTeam,
      role: p.role,
      quotation: p.quotation,
      taken: taken.has(p.id),
    }));
  }

  /** Filename e data dell'ultimo import: la tab Listone li mostra in testa. */
  async lastImport(): Promise<LastImport> {
    const league = await ensureLeague(this.prisma);
    const count = await this.prisma.player.count();
    return {
      filename: league.lastImportName ?? '—',
      at: league.lastImportAt ? league.lastImportAt.toLocaleDateString('it-IT') : '—',
      count: count || league.lastImportCount,
    };
  }

  /**
   * Importa/aggiorna il listone dall'xlsx di Fantacalcio.it.
   *
   * Il re-import a metà asta è previsto (PLAN.md, decisione 2): si aggiornano
   * quotazioni e ruoli, **non** si cancella nessun giocatore e non si tocca
   * nessuna `Acquisition`. Le rose già fatte restano quindi valide.
   */
  async importFromXlsx(file?: Express.Multer.File): Promise<ImportResult> {
    if (!file?.buffer?.length) throw new BadRequestException('File mancante');
    const parsed = parseFantacalcioXlsx(file.buffer);
    if (!parsed.length) throw new BadRequestException('Nessun calciatore valido nel file');

    const existing = await this.prisma.player.findMany();
    const byExternalId = new Map(
      existing.filter((p) => p.externalId != null).map((p) => [p.externalId!, p]),
    );
    const byNameTeam = new Map(existing.map((p) => [this.key(p.name, p.realTeam), p]));

    const toCreate: ParsedPlayer[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const p of parsed) {
      const match =
        (p.externalId != null ? byExternalId.get(p.externalId) : undefined) ??
        byNameTeam.get(this.key(p.name, p.realTeam));
      if (!match) {
        toCreate.push(p);
        continue;
      }
      const changed =
        match.quotation !== p.quotation ||
        match.role !== p.role ||
        (match.fvm ?? null) !== (p.fvm ?? null) ||
        (match.externalId ?? null) !== (p.externalId ?? null);
      if (!changed) continue;
      updates.push(
        this.prisma.player.update({
          where: { id: match.id },
          data: {
            quotation: p.quotation,
            role: p.role,
            fvm: p.fvm ?? null,
            externalId: p.externalId ?? match.externalId,
          },
        }),
      );
    }

    if (toCreate.length) {
      await this.prisma.player.createMany({
        data: toCreate.map((p) => ({
          externalId: p.externalId,
          name: p.name,
          realTeam: p.realTeam,
          role: p.role,
          quotation: p.quotation,
          fvm: p.fvm,
        })),
        skipDuplicates: true,
      });
    }
    // A blocchi: una transazione con 600 update sfonderebbe i timeout del tier free.
    for (let i = 0; i < updates.length; i += 100) {
      await this.prisma.$transaction(updates.slice(i, i + 100));
    }

    const total = await this.prisma.player.count();
    const league = await ensureLeague(this.prisma);
    await this.prisma.league.update({
      where: { id: league.id },
      data: {
        lastImportName: file.originalname || 'listone.xlsx',
        lastImportAt: new Date(),
        lastImportCount: total,
      },
    });
    // Le quotazioni cambiano il prezzo base con `startPriceMode: 'quotation'`.
    await this.auction.refresh();

    this.log.log(
      `Import ${file.originalname}: ${toCreate.length} nuovi, ${updates.length} aggiornati, ${total} a listone`,
    );
    return { imported: toCreate.length, updated: updates.length, total };
  }

  private key(name: string, team: string): string {
    return `${name.toLowerCase()}|${team.toLowerCase()}`;
  }
}

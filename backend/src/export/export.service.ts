import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ensureLeague } from '../rules/league.util';
import { buildRostersCsv, SkippedPlayer } from './rosters-csv';

export interface RostersExport {
  filename: string;
  csv: string;
  /** Acquisti non esportabili: il client li mostra invece di far scoprire il buco a valle. */
  skipped: SkippedPlayer[];
}

/**
 * Export delle rose nel CSV che Fantacalcio.it sa importare. Sola lettura: non
 * tocca né lo stato live né il DB, quindi si può lanciare anche ad asta in corso.
 */
@Injectable()
export class ExportService {
  private readonly log = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async rosters(): Promise<RostersExport> {
    const league = await ensureLeague(this.prisma);
    // Ordine di creazione: lo stesso con cui `AuctionService` costruisce lo
    // snapshot, così il file rispecchia l'ordine che l'admin vede a schermo.
    const participants = await this.prisma.participant.findMany({
      where: { leagueId: league.id },
      orderBy: { createdAt: 'asc' },
      include: { acquisitions: { include: { player: true } } },
    });

    const { csv, skipped } = buildRostersCsv(
      participants.map((p) => ({
        teamName: p.teamName,
        roster: p.acquisitions.map((a) => ({
          externalId: a.player.externalId,
          name: a.player.name,
          realTeam: a.player.realTeam,
          price: a.price,
        })),
      })),
    );

    if (skipped.length) {
      this.log.warn(
        `Export rose: ${skipped.length} acquisti senza id Fantacalcio.it, esclusi dal file — ` +
          skipped.map((s) => `${s.name} (${s.realTeam})`).join(', '),
      );
    }

    return {
      filename: `fanta-asta-live-rosters-${Date.now()}.csv`,
      csv,
      skipped,
    };
  }
}

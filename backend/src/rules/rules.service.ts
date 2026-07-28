import { Injectable, NotFoundException } from '@nestjs/common';
import { League, Prisma } from '@prisma/client';
import { AuctionRules } from '../auction/dto/events';
import { AuctionService } from '../auction/auction.service';
import { PrismaService } from '../prisma/prisma.service';
import { ensureLeague, toAuctionRules } from './league.util';
import { UpdateRulesDto } from './dto/update-rules.dto';

@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auction: AuctionService,
  ) {}

  /** Ritorna la lega (crea quella di default se non esiste). */
  getLeague(): Promise<League> {
    return ensureLeague(this.prisma);
  }

  async getRules(): Promise<AuctionRules> {
    return toAuctionRules(await this.getLeague());
  }

  /**
   * Applica una patch alle regole. Se cambia il budget, i crediti residui di tutti
   * i partecipanti vengono ricalcolati come `budget - speso`: l'admin che alza il
   * tetto a metà asta non azzera gli acquisti già fatti.
   */
  async updateRules(dto: UpdateRulesDto): Promise<AuctionRules> {
    const league = await this.getLeague();
    const data: Prisma.LeagueUpdateInput = {};
    if (dto.leagueName !== undefined) data.leagueName = dto.leagueName;
    if (dto.auctionName !== undefined) data.auctionName = dto.auctionName;
    if (dto.budget !== undefined) data.budget = dto.budget;
    if (dto.callOrder !== undefined) data.callOrder = dto.callOrder;
    if (dto.bidTimerSeconds !== undefined) data.bidTimerSeconds = dto.bidTimerSeconds;
    if (dto.startPriceMode !== undefined) data.startPriceMode = dto.startPriceMode;
    if (dto.startPrice !== undefined) data.startPrice = dto.startPrice;
    if (dto.releaseRefund !== undefined) data.releaseRefund = dto.releaseRefund;
    if (dto.rosterSlots) {
      data.slotsP = dto.rosterSlots.P;
      data.slotsD = dto.rosterSlots.D;
      data.slotsC = dto.rosterSlots.C;
      data.slotsA = dto.rosterSlots.A;
    }

    const updated = await this.prisma.league.update({ where: { id: league.id }, data });
    if (dto.budget !== undefined && dto.budget !== league.budget) {
      await this.rebalanceBudgets(updated);
    }
    await this.auction.refresh();
    return toAuctionRules(updated);
  }

  /**
   * `budget residuo = nuovo tetto + creditAdjustment - già speso`, per tutti.
   *
   * `creditAdjustment` non è un dettaglio contabile: senza, alzare il tetto di
   * lega dopo un mercato di riparazione cancellerebbe le ricariche di
   * `admin:startRepair` e tutti i rimborsi di svincolo diversi dal prezzo pagato.
   * È l'invariante documentato su `Participant.creditAdjustment`.
   */
  private async rebalanceBudgets(league: League): Promise<void> {
    const participants = await this.prisma.participant.findMany({
      where: { leagueId: league.id },
      include: { acquisitions: { select: { price: true } } },
    });
    await this.prisma.$transaction(
      participants.map((p) => {
        const spent = p.acquisitions.reduce((n, a) => n + a.price, 0);
        return this.prisma.participant.update({
          where: { id: p.id },
          data: { budget: league.budget + p.creditAdjustment - spent },
        });
      }),
    );
  }

  async setTurnOrder(participantIds: string[]): Promise<{ turnOrder: string[] }> {
    const league = await this.getLeague();
    const participants = await this.prisma.participant.findMany({
      where: { leagueId: league.id },
      select: { id: true },
    });
    const known = new Set(participants.map((p) => p.id));
    const invalid = participantIds.filter((id) => !known.has(id));
    if (invalid.length) {
      throw new NotFoundException(`Partecipanti non trovati: ${invalid.join(', ')}`);
    }
    const updated = await this.prisma.league.update({
      where: { id: league.id },
      data: { turnOrder: participantIds },
    });
    await this.auction.refresh();
    return { turnOrder: updated.turnOrder };
  }
}

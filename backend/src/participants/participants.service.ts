import { Injectable, NotFoundException } from '@nestjs/common';
import { AuctionService } from '../auction/auction.service';
import { Participant } from '../auction/dto/events';
import { PrismaService } from '../prisma/prisma.service';
import { randomAccessCode, randomMagicToken, teamColor } from '../rules/league.util';
import { RulesService } from '../rules/rules.service';
import { CreateParticipantDto, UpdateParticipantDto } from './dto/participant.dto';

/**
 * CRUD dei partecipanti. Le letture passano **sempre** dallo stato live
 * dell'asta, così REST e socket raccontano la stessa cosa (rose con i prezzi,
 * `spent`, `online`) e c'è un solo punto che decide se i codici d'accesso escono.
 */
@Injectable()
export class ParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
    private readonly auction: AuctionService,
  ) {}

  async list(forAdmin: boolean): Promise<Participant[]> {
    const state = await this.auction.getState(forAdmin);
    return state.participants;
  }

  async create(dto: CreateParticipantDto): Promise<Participant[]> {
    const league = await this.rules.getLeague();
    const count = await this.prisma.participant.count({ where: { leagueId: league.id } });
    await this.prisma.participant.create({
      data: {
        leagueId: league.id,
        name: dto.name?.trim() || 'Nuovo',
        teamName: dto.teamName?.trim() || `Squadra ${count + 1}`,
        avatarUrl: dto.avatarUrl,
        color: dto.color ?? teamColor(count),
        accessCode: await this.freshCode(league.id),
        magicToken: randomMagicToken(),
        budget: dto.budget ?? league.budget,
      },
    });
    // Il nuovo arrivato entra in coda all'ordine di chiamata.
    await this.auction.refresh();
    return this.list(true);
  }

  async update(id: string, dto: UpdateParticipantDto): Promise<Participant[]> {
    await this.mustExist(id);
    await this.prisma.participant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.teamName !== undefined ? { teamName: dto.teamName } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.budget !== undefined ? { budget: dto.budget } : {}),
      },
    });
    await this.auction.refresh();
    return this.list(true);
  }

  async remove(id: string): Promise<Participant[]> {
    const participant = await this.mustExist(id);
    const league = await this.rules.getLeague();
    await this.prisma.$transaction([
      this.prisma.participant.delete({ where: { id } }),
      this.prisma.league.update({
        where: { id: league.id },
        data: { turnOrder: league.turnOrder.filter((pid) => pid !== participant.id) },
      }),
    ]);
    await this.auction.refresh();
    return this.list(true);
  }

  /**
   * Nuovo codice d'accesso: si usa quando il vecchio è finito in mani sbagliate.
   * Rigenerare una credenziale **butta giù le sessioni** già aperte di quella
   * squadra (`tokenVersion`), altrimenti chi ha già il JWT in `localStorage`
   * resterebbe dentro e la revoca non revocherebbe niente.
   */
  async regenerateCode(id: string): Promise<Participant> {
    await this.mustExist(id);
    const league = await this.rules.getLeague();
    return this.rotate(id, { accessCode: await this.freshCode(league.id) });
  }

  /**
   * Nuovo magic link. Stessa storia del codice: il link vecchio smette di
   * funzionare e le sessioni nate da quel link cadono.
   */
  async regenerateLink(id: string): Promise<Participant> {
    await this.mustExist(id);
    return this.rotate(id, { magicToken: randomMagicToken() });
  }

  private async rotate(
    id: string,
    credential: { accessCode: string } | { magicToken: string },
  ): Promise<Participant> {
    await this.prisma.participant.update({
      where: { id },
      data: { ...credential, tokenVersion: { increment: 1 } },
    });
    await this.auction.refresh();
    const participants = await this.list(true);
    return participants.find((p) => p.id === id)!;
  }

  /**
   * Reset asta: cancella le acquisizioni, ripristina i budget, riapre i reparti
   * chiusi e riporta la sala a `IDLE`. Il listone non si tocca.
   *
   * Azzera anche il mercato di riparazione — svincoli, `repairRound` e
   * `creditAdjustment`. Quest'ultimo è obbligatorio: se sopravvivesse al reset,
   * i budget ripartirebbero con le ricariche e i rimborsi di un'asta che non
   * esiste più (vedi l'invariante su `Participant.creditAdjustment`).
   */
  async resetAuction(): Promise<{ ok: true }> {
    const league = await this.rules.getLeague();
    await this.prisma.$transaction([
      this.prisma.acquisition.deleteMany({ where: { leagueId: league.id } }),
      this.prisma.release.deleteMany({ where: { leagueId: league.id } }),
      this.prisma.participant.updateMany({
        where: { leagueId: league.id },
        data: { budget: league.budget, creditAdjustment: 0 },
      }),
      this.prisma.league.update({
        where: { id: league.id },
        data: { status: 'IDLE', closedRoles: [], repairRound: 0 },
      }),
    ]);
    await this.auction.resetLive();
    return { ok: true };
  }

  private async mustExist(id: string) {
    const participant = await this.prisma.participant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException(`Partecipante ${id} non trovato`);
    return participant;
  }

  /** Codice a 6 caratteri non ancora in uso nella lega. */
  private async freshCode(leagueId: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomAccessCode();
      const clash = await this.prisma.participant.findFirst({
        where: { leagueId, accessCode: code },
        select: { id: true },
      });
      if (!clash) return code;
    }
    // 32^6 combinazioni: arrivare qui significa che il DB è pieno di squadre.
    throw new Error('Impossibile generare un codice d’accesso libero');
  }
}

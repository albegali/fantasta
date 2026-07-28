import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuctionStatus as DbStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPlayerView } from '../players/player.view';
import { ensureLeague, toAuctionRules } from '../rules/league.util';
import { AuctionError } from './auction-error';
import { AuctionLogService, LogQuery } from './auction-log.service';
import {
  ASSIGNED_HOLD_MS,
  AuctionLogEntry,
  AuctionLogType,
  AuctionState,
  AuctionStatus,
  BudgetUpdatedPayload,
  EV,
  FILLING_PRICE,
  LastAssigned,
  Participant,
  Player,
  ReleaseEntry,
  Role,
} from './dto/events';
import {
  applyAssignment,
  applyPurchase,
  applyRefund,
  applyRelease,
  applyUnrelease,
  canAssignManual,
  canClaim,
  canHoldLot,
  canNominate,
  canRelease,
  canUnrelease,
  computeMaxBid,
  currentRole,
  isFinished,
  needsFilling,
  nextTurn,
  refundFor,
  remainingSlotsInRole,
  ROLE_LABEL_PLURAL,
  slotsUsed,
  startPriceFor,
  turnFrom,
  validateBid,
  Verdict,
} from './auction-engine';

/**
 * Il gateway registra qui i suoi due soli compiti: mandare uno snapshot (che
 * costruisce per pubblico, filtrando i codici d'accesso) e inoltrare un evento.
 */
export interface AuctionBroadcaster {
  broadcastState(): void;
  broadcast(event: string, payload: unknown): void;
}

/** Cadenza dei `tick`: puro smoothing per la UI, la verità è `lot.endsAt`. */
const TICK_MS = 250;

/**
 * Orchestratore dell'asta. Tiene lo stato LIVE in memoria (una sola lega nel
 * boilerplate) e persiste ciò che deve sopravvivere a un riavvio: acquisizioni,
 * budget, reparti chiusi, stato dell'asta.
 *
 * Tre regole non negoziabili (AGENTS.md §"Regole specifiche"):
 * 1. **timer server-side**: `endsAt` assoluto, reset a ogni rilancio valido;
 * 2. **mutazioni serializzate** da `run()`: una coda per la lega, niente race;
 * 3. **niente decisioni fuori da qui**: il gateway trasporta, l'engine giudica.
 */
@Injectable()
export class AuctionService implements OnModuleInit {
  private readonly log = new Logger(AuctionService.name);

  private state: AuctionState | null = null;
  private leagueId = '';
  private bus?: AuctionBroadcaster;

  /** Quante socket per partecipante: `online` è vero finché ce n'è almeno una. */
  private readonly sockets = new Map<string, number>();

  private queue: Promise<unknown> = Promise.resolve();
  private lotTimeout?: NodeJS.Timeout;
  private tickInterval?: NodeJS.Timeout;
  private assignedTimeout?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: AuctionLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Un DB non raggiungibile al boot non deve impedire l'avvio: si riprova al
    // primo accesso (tier gratuiti = cold start, vedi INFRA.md).
    try {
      await this.run(() => this.load());
    } catch (e) {
      this.log.warn(`Stato d'asta non caricato all'avvio: ${(e as Error).message}`);
    }
  }

  attachBroadcaster(bus: AuctionBroadcaster): void {
    this.bus = bus;
  }

  // ---------------------------------------------------------------------------
  // Coda di serializzazione
  // ---------------------------------------------------------------------------
  /** Serializza ogni mutazione di stato (mutex a coda per la lega). */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Bootstrap / ricarica dello stato live dal DB
  // ---------------------------------------------------------------------------
  private async load(): Promise<AuctionState> {
    const league = await ensureLeague(this.prisma);
    this.leagueId = league.id;
    const rules = toAuctionRules(league);
    const participants = await this.readParticipants();
    const turnOrder = this.alignTurnOrder(league.turnOrder, participants);

    this.state = {
      // Un lotto aperto non sopravvive a un riavvio: si riparte dal turno.
      status: league.status === 'BIDDING' || league.status === 'ASSIGNED' ? 'IDLE' : league.status,
      rules,
      participants,
      turnOrder,
      currentTurnParticipantId: turnOrder[0] ?? '',
      currentRole: null,
      closedRoles: league.closedRoles,
      lot: null,
      lastAssigned: null,
      // Una finestra di svincolo **sopravvive** a un riavvio: non ha timer né
      // lotto in volo, quindi non c'è niente di perso da ricostruire.
      repairRound: league.repairRound,
      releases: await this.readReleases(league.repairRound),
      log: await this.logs.load(league.id),
    };
    return this.state;
  }

  /**
   * Ricarica regole, partecipanti e ordine dei turni dal DB **preservando** il
   * lotto in corso: le rotte REST d'admin (regole, partecipanti, ordine) possono
   * essere usate anche a sala aperta.
   */
  private async refreshFromDb(): Promise<void> {
    if (!this.state) {
      await this.load();
      return;
    }
    const league = await ensureLeague(this.prisma);
    const s = this.state;
    s.rules = toAuctionRules(league);
    s.participants = await this.readParticipants();
    s.closedRoles = league.closedRoles;
    s.repairRound = league.repairRound;
    s.releases = await this.readReleases(league.repairRound);
    s.turnOrder = this.alignTurnOrder(league.turnOrder, s.participants);
    if (!s.participants.some((p) => p.id === s.currentTurnParticipantId)) {
      s.currentTurnParticipantId = s.turnOrder[0] ?? '';
    }
    // Il partecipante che teneva il lotto potrebbe essere stato cancellato.
    if (s.lot && !s.participants.some((p) => p.id === s.lot!.bestParticipantId)) {
      this.clearTimers();
      s.lot = null;
      s.status = 'IDLE';
    }
  }

  private async readParticipants(): Promise<Participant[]> {
    const rows = await this.prisma.participant.findMany({
      where: { leagueId: this.leagueId },
      include: { acquisitions: { include: { player: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      teamName: p.teamName,
      avatarUrl: p.avatarUrl,
      color: p.color ?? undefined,
      budget: p.budget,
      spent: p.acquisitions.reduce((n, a) => n + a.price, 0),
      roster: p.acquisitions.map((a) => ({
        playerId: a.playerId,
        name: a.player.name,
        team: a.player.realTeam,
        role: a.player.role,
        price: a.price,
      })),
      online: (this.sockets.get(p.id) ?? 0) > 0,
      accessCode: p.accessCode,
      magicToken: p.magicToken,
    }));
  }

  /**
   * Gli svincoli del round di riparazione in corso, il più recente in testa.
   * Fuori dalla riparazione (`repairRound: 0`) è sempre vuoto: i round passati
   * restano in tabella come storia, ma non entrano nello snapshot.
   */
  private async readReleases(repairRound: number): Promise<ReleaseEntry[]> {
    if (repairRound < 1) return [];
    const rows = await this.prisma.release.findMany({
      where: { leagueId: this.leagueId, repairRound },
      include: { player: true, participant: { select: { teamName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      playerId: r.playerId,
      name: r.player.name,
      team: r.player.realTeam,
      role: r.player.role,
      participantId: r.participantId,
      teamName: r.participant.teamName,
      price: r.price,
      refund: r.refund,
    }));
  }

  /** L'ordine salvato vince; chi non c'è viene aggiunto in coda, gli orfani cadono. */
  private alignTurnOrder(saved: string[], participants: Participant[]): string[] {
    const known = new Set(participants.map((p) => p.id));
    const ordered = saved.filter((id) => known.has(id));
    for (const p of participants) if (!ordered.includes(p.id)) ordered.push(p.id);
    return ordered;
  }

  private async ensure(): Promise<AuctionState> {
    if (!this.state) await this.load();
    return this.state!;
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------
  /**
   * Snapshot da mandare ai client. `currentRole` è **derivato qui** a ogni
   * emissione: non può restare indietro rispetto alle rose. Le credenziali —
   * `accessCode` e `magicToken` — escono solo verso l'admin (PLAN.md, decisioni
   * 7 e 21).
   */
  snapshot(forAdmin: boolean): AuctionState | null {
    const s = this.state;
    if (!s) return null;
    return {
      ...s,
      currentRole: currentRole(s),
      participants: s.participants.map((p) =>
        forAdmin ? { ...p } : { ...p, accessCode: undefined, magicToken: undefined },
      ),
    };
  }

  /** Snapshot per chi arriva via REST (bootstrap pre-auth della schermata Accesso). */
  async getState(forAdmin: boolean): Promise<AuctionState> {
    await this.run(() => this.ensure());
    return this.snapshot(forAdmin)!;
  }

  private pushState(): void {
    this.bus?.broadcastState();
  }

  /**
   * Aggiunge una riga di telecronaca e la mette nella coda dello snapshot. Va
   * chiamata **dopo** che il fatto è successo davvero (dopo la transazione, per un
   * acquisto) e **prima** del `pushState` che lo racconta, così chi riceve lo
   * snapshot ci trova già la riga.
   *
   * Non attende il DB: la scrittura è in coda dentro `AuctionLogService`.
   */
  private note(
    type: AuctionLogType,
    opts: {
      participantId?: string | null;
      player?: Player;
      /** Reparto, quando non lo porta già il calciatore (es. reparto chiuso). */
      role?: Role | null;
      price?: number | null;
      detail?: string | null;
      at?: number;
    },
  ): void {
    const s = this.state;
    if (!s || !this.leagueId) return;
    const participantId = opts.participantId ?? null;
    s.log = this.logs.append(this.leagueId, {
      type,
      at: opts.at,
      participantId,
      teamName: participantId
        ? (s.participants.find((p) => p.id === participantId)?.teamName ?? null)
        : null,
      playerId: opts.player?.id ?? null,
      playerName: opts.player?.name ?? null,
      role: opts.player?.role ?? opts.role ?? null,
      price: opts.price ?? null,
      detail: opts.detail ?? null,
    });
  }

  /** Storia completa della telecronaca (paginata): la coda recente è nello snapshot. */
  async history(query: LogQuery = {}): Promise<AuctionLogEntry[]> {
    await this.run(() => this.ensure());
    return this.logs.list(this.leagueId, query);
  }

  private pushBudget(participantId: string): void {
    const s = this.state!;
    const p = s.participants.find((x) => x.id === participantId);
    if (!p) return;
    const payload: BudgetUpdatedPayload = {
      participantId,
      budget: p.budget,
      slots: slotsUsed(p),
      maxBid: computeMaxBid(p, s.rules),
    };
    this.bus?.broadcast(EV.BUDGET_UPDATED, payload);
  }

  // ---------------------------------------------------------------------------
  // Presenza
  // ---------------------------------------------------------------------------
  // Chi sia il partecipante lo decide `AuthService` (sessione, magic token o
  // codice): qui si contano solo le socket.

  /** Una socket in più per questo partecipante: `online` diventa vero. */
  connectParticipant(participantId: string): Promise<void> {
    return this.run(async () => {
      const before = this.sockets.get(participantId) ?? 0;
      this.sockets.set(participantId, before + 1);
      if (before === 0) this.markOnline(participantId, true);
    });
  }

  /** Socket chiusa: `online` torna falso solo quando non ne resta nessuna. */
  disconnectParticipant(participantId: string): Promise<void> {
    return this.run(async () => {
      const before = this.sockets.get(participantId) ?? 0;
      const after = Math.max(0, before - 1);
      if (after === 0) this.sockets.delete(participantId);
      else this.sockets.set(participantId, after);
      if (before > 0 && after === 0) this.markOnline(participantId, false);
    });
  }

  private markOnline(participantId: string, online: boolean): void {
    const p = this.state?.participants.find((x) => x.id === participantId);
    if (!p || p.online === online) return;
    p.online = online;
    this.pushState();
  }

  // ---------------------------------------------------------------------------
  // Comandi admin
  // ---------------------------------------------------------------------------
  /**
   * Apre la sala: reparto e turno li decide `continueAuction`, partendo dal primo.
   * È anche il comando che **chiude la finestra di svincolo** di un mercato di
   * riparazione: da lì in poi i tagli sono definitivi e si batte sui buchi creati.
   */
  start(): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      this.clearTimers();
      const closingWindow = s.status === 'RELEASING';
      s.lot = null;
      s.lastAssigned = null;
      s.status = 'IDLE';
      this.note('start', {
        detail: closingWindow
          ? `riparazione ${s.repairRound}: ${s.releases.length} svincoli, si riparte`
          : s.rules.auctionName,
      });
      await this.continueAuction(0);
    });
  }

  /**
   * A finestra di svincolo aperta i comandi d'asta non hanno un significato: non
   * c'è un turno da saltare, un reparto da chiudere, un timer da fermare. Vanno
   * **rifiutati**, non eseguiti a vuoto: eseguirli farebbe uscire la sala da
   * `RELEASING` passando da `continueAuction`, chiudendo la finestra di nascosto.
   */
  private refuseDuringReleasing(s: AuctionState, what: string): void {
    if (s.status !== 'RELEASING') return;
    throw new AuctionError('NOT_IDLE', `Finestra di svincolo aperta: ${what}`);
  }

  /** Pausa: ferma i timer e congela il lotto. `resume` riparte con timer pieno. */
  pause(): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      this.refuseDuringReleasing(s, 'non c’è niente da mettere in pausa.');
      this.clearTimers();
      s.status = 'PAUSED';
      await this.persistStatus('PAUSED');
      this.note('pause', { player: s.lot?.player });
      this.pushState();
    });
  }

  resume(): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (s.status !== 'PAUSED') return;
      if (s.lot) {
        // Il timer riparte intero: chi si era distratto durante la pausa non perde il lotto.
        s.status = 'BIDDING';
        s.lot.endsAt = Date.now() + s.rules.bidTimerSeconds * 1000;
        this.startLotTimer();
      } else if (needsFilling(s)) {
        s.status = 'FILLING';
      } else if (isFinished(s)) {
        s.status = 'FINISHED';
      } else {
        s.status = 'IDLE';
      }
      await this.persistStatus(s.status);
      this.note('resume', { player: s.lot?.player });
      this.pushState();
    });
  }

  /** Salta il turno. Con un lotto aperto lo annulla: nessuno se lo aggiudica. */
  skipTurn(): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      this.refuseDuringReleasing(s, 'non c’è nessun turno da saltare.');
      this.clearTimers();
      const cancelled = s.lot;
      s.lot = null;
      s.lastAssigned = null;
      this.note('skip', {
        participantId: s.currentTurnParticipantId,
        player: cancelled?.player,
        price: cancelled?.price,
        detail: cancelled ? 'lotto annullato' : null,
      });
      const from = s.turnOrder.indexOf(s.currentTurnParticipantId) + 1;
      await this.continueAuction(from);
    });
  }

  /**
   * L'admin chiude il reparto in corso e passa al successivo **anche se
   * incompleto**. Serve al caso tipico: restano pochi slot che nessuno si
   * contenderebbe e che verrebbero comprati a 1 credito senza asta. Gli slot
   * rimasti non tornano all'asta: si riempiono negli svincoli finali.
   *
   * Irreversibile, e vietato a lotto aperto.
   */
  advanceRole(): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (s.lot) throw new AuctionError('LOT_OPEN', 'Chiudi prima il lotto in corso.');
      this.refuseDuringReleasing(s, 'chiudila con «Avvia» e poi passa i reparti.');
      if (s.rules.callOrder !== 'fixed') {
        throw new AuctionError(
          'NOT_FIXED_ORDER',
          'I reparti esistono solo con ordine per reparto.',
        );
      }
      if (isFinished(s)) {
        throw new AuctionError('ALREADY_COMPLETE', 'Le rose sono già complete.');
      }
      const role = currentRole(s);
      if (role) {
        const leftover = remainingSlotsInRole(s, role);
        s.closedRoles = [...s.closedRoles, role];
        await this.prisma.league.update({
          where: { id: this.leagueId },
          data: { closedRoles: s.closedRoles as Role[] },
        });
        this.note('roleClosed', {
          role,
          detail: `${ROLE_LABEL_PLURAL[role]}, ${leftover} slot lasciati vuoti`,
        });
        this.log.log(
          `Reparto ${ROLE_LABEL_PLURAL[role]} chiuso dall'admin con ${leftover} slot vuoti`,
        );
      }
      // Il nuovo reparto riparte dal primo dell'ordine di chiamata.
      await this.continueAuction(0);
    });
  }

  /**
   * Assegnazione manuale: registra un acquisto deciso fuori dall'asta. Non è
   * vincolata al reparto in corso, ma slot e crediti sì. Si comporta come un
   * lotto chiuso, quindi la sala vede il risultato e poi il turno avanza.
   */
  assignManual(playerId: number, participantId: string, price: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (s.lot) throw new AuctionError('LOT_OPEN', 'Chiudi prima il lotto in corso.');
      this.refuseDuringReleasing(s, 'chiudila prima di assegnare a mano.');
      const player = await this.findPlayer(playerId);
      this.check(canAssignManual(s, participantId, player, price));
      await this.settleAssignment(participantId, player!, price);
    });
  }

  /**
   * Riapre un lotto già chiuso: **rimborsa il compratore e si ribatte**
   * (PLAN.md, decisione 18). Serve quando un lotto si è chiuso male — un rilancio
   * urlato che il server non ha visto, un prezzo digitato storto, una contestazione.
   *
   * Il calciatore torna all'asta al **prezzo base di lega**, non al prezzo a cui
   * era stato venduto: si ribatte da zero. La chiamata torna a chi l'aveva fatta
   * (`Acquisition.nominatedById`); se quel partecipante non ha più lo slot o i
   * crediti — o se il lotto non era mai stato chiamato, come per svincoli e
   * assegnazioni manuali — il lotto lo tiene il compratore rimborsato.
   *
   * A sala in pausa il lotto si riapre **senza** far partire il timer: `resume`
   * lo rimette in moto con il countdown pieno. È il flusso naturale di una
   * contestazione: pausa → sistemo → riprendo.
   */
  reopenLot(playerId: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (s.lot) throw new AuctionError('LOT_OPEN', 'Chiudi prima il lotto in corso.');
      this.refuseDuringReleasing(s, 'un lotto non si riapre dentro la finestra.');
      const player = await this.findPlayer(playerId);
      if (!player) throw new AuctionError('UNKNOWN_PLAYER', 'Calciatore sconosciuto.');

      const acquisition = await this.prisma.acquisition.findUnique({
        where: { leagueId_playerId: { leagueId: this.leagueId, playerId } },
      });
      if (!acquisition) {
        throw new AuctionError('NOT_ASSIGNED', 'Questo calciatore non è assegnato a nessuno.');
      }
      const buyerId = acquisition.participantId;
      if (!s.participants.some((p) => p.id === buyerId)) {
        throw new AuctionError('UNKNOWN_PARTICIPANT', 'Il compratore non è più in lega.');
      }
      this.clearTimers(); // può arrivare durante il fermo-immagine di ASSIGNED

      // 1. Rimborso: prima il DB, poi la memoria (come ogni altra mutazione).
      const { participants, price: refunded } = applyRefund(s, buyerId, playerId);
      const buyer = participants.find((p) => p.id === buyerId)!;
      await this.prisma.$transaction([
        this.prisma.acquisition.delete({ where: { id: acquisition.id } }),
        this.prisma.participant.update({
          where: { id: buyerId },
          data: { budget: buyer.budget },
        }),
      ]);
      s.participants = participants;

      // 2. A chi torna la chiamata.
      const price = startPriceFor(s.rules, player);
      const caller = [acquisition.nominatedById, buyerId].find((id) =>
        canHoldLot(s, id, player, price),
      );
      if (!caller) {
        throw new AuctionError(
          'INSUFFICIENT_CREDITS',
          `Nessuno può tenere il lotto a ${price}: assegnalo a mano.`,
        );
      }

      // 3. Il lotto torna all'asta da zero.
      const at = Date.now();
      s.lot = {
        player,
        byParticipantId: caller,
        price,
        bestParticipantId: caller,
        endsAt: at + s.rules.bidTimerSeconds * 1000,
        history: [{ participantId: caller, price, type: 'nominate', at }],
      };
      s.currentTurnParticipantId = caller;
      s.lastAssigned = null;
      const paused = s.status === 'PAUSED';
      if (!paused) {
        s.status = 'BIDDING';
        await this.persistStatus('BIDDING');
      }

      this.note('reopen', {
        participantId: buyerId,
        player,
        price: refunded,
        detail: `si ribatte da ${price}`,
      });
      this.bus?.broadcast(EV.NOMINATED, {
        player,
        byParticipantId: caller,
        price,
        endsAt: s.lot.endsAt,
      });
      this.pushBudget(buyerId);
      this.pushState();
      if (!paused) this.startLotTimer();
      this.log.log(
        `Lotto riaperto: ${player.name} — rimborsati ${refunded} crediti a ${buyer.teamName}` +
          `${paused ? ' (in pausa: riparte con resume)' : ''}`,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Mercato di riparazione
  // ---------------------------------------------------------------------------
  /**
   * Apre un mercato di riparazione. Non è un'asta nuova: le rose e i crediti
   * residui restano quelli dell'asta iniziale, e l'unica cosa che si fa qui è
   * **aprire la finestra di svincolo** (`RELEASING`). I buchi che le squadre
   * creeranno tagliando sono quel che tornerà all'asta quando l'admin farà
   * `admin:start`.
   *
   * Tre effetti sullo stato di lega:
   * 1. `repairRound` avanza — è l'etichetta del round e il filtro degli svincoli;
   * 2. i **reparti chiusi si riaprono**: `advanceRole` era una decisione dell'asta
   *    d'agosto, non deve zavorrare la riparazione di gennaio;
   * 3. `extraBudget` è una ricarica uguale per tutti, che finisce in
   *    `creditAdjustment` per non falsare il ricalcolo dei residui.
   *
   * Vietato a lotto aperto: si riapre un mercato fra un lotto e l'altro, non dentro.
   */
  startRepair(extraBudget = 0): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (s.lot) throw new AuctionError('LOT_OPEN', 'Chiudi prima il lotto in corso.');
      this.refuseDuringReleasing(s, 'c’è già un mercato aperto.');
      if (!Number.isInteger(extraBudget) || extraBudget < 0) {
        throw new AuctionError('BID_INVALID', 'La ricarica di crediti non è valida.');
      }
      if (!s.participants.length) {
        throw new AuctionError('UNKNOWN_PARTICIPANT', 'Non c’è nessuna squadra in lega.');
      }
      this.clearTimers();

      const round = s.repairRound + 1;
      await this.prisma.$transaction([
        this.prisma.league.update({
          where: { id: this.leagueId },
          data: { repairRound: round, closedRoles: [], status: 'RELEASING' },
        }),
        this.prisma.participant.updateMany({
          where: { leagueId: this.leagueId },
          data: {
            budget: { increment: extraBudget },
            creditAdjustment: { increment: extraBudget },
          },
        }),
      ]);

      s.repairRound = round;
      s.closedRoles = [];
      s.releases = [];
      s.lot = null;
      s.lastAssigned = null;
      s.status = 'RELEASING';
      if (extraBudget > 0) {
        s.participants = s.participants.map((p) => ({ ...p, budget: p.budget + extraBudget }));
      }

      this.note('repairStart', {
        detail:
          extraBudget > 0 ? `round ${round}, +${extraBudget} crediti a tutti` : `round ${round}`,
        price: extraBudget || null,
      });
      this.log.log(
        `Mercato di riparazione ${round} aperto (ricarica ${extraBudget}): finestra di svincolo`,
      );
      for (const p of s.participants) this.pushBudget(p.id);
      this.pushState();
    });
  }

  /**
   * Il partecipante taglia un calciatore dalla **propria** rosa. Il rimborso lo
   * decide `rules.releaseRefund`, non chi taglia.
   *
   * L'`Acquisition` si **cancella** invece di essere marcata: il vincolo unico
   * `(leagueId, playerId)` deve tornare libero perché il calciatore possa essere
   * ricomprato — anche dalla stessa squadra. Quel che serviva sopravvive nella
   * riga `Release` (prezzo, rimborso, chi aveva chiamato).
   */
  release(participantId: string, playerId: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      const me = s.participants.find((p) => p.id === participantId);
      const entry = me?.roster.find((r) => r.playerId === playerId);
      // Il rimborso serve prima del verdetto: è `canRelease` a dire se, col
      // rimborso incassato, la rosa resta completabile.
      const player = entry ? await this.findPlayer(playerId) : undefined;
      const refund = entry
        ? refundFor(s.rules.releaseRefund, entry.price, player?.quotation ?? entry.price)
        : 0;
      this.check(canRelease(s, participantId, playerId, refund));

      const acquisition = await this.prisma.acquisition.findUnique({
        where: { leagueId_playerId: { leagueId: this.leagueId, playerId } },
      });
      if (!acquisition) {
        throw new AuctionError('NOT_IN_ROSTER', 'Questo calciatore non risulta più tuo.');
      }

      const { participants, released } = applyRelease(s, participantId, playerId, refund);
      const owner = participants.find((p) => p.id === participantId)!;
      await this.prisma.$transaction([
        this.prisma.acquisition.delete({ where: { id: acquisition.id } }),
        this.prisma.release.create({
          data: {
            leagueId: this.leagueId,
            participantId,
            playerId,
            price: released.price,
            refund,
            nominatedById: acquisition.nominatedById,
            repairRound: s.repairRound,
          },
        }),
        this.prisma.participant.update({
          where: { id: participantId },
          data: {
            budget: owner.budget,
            // La differenza fra rimborso e prezzo pagato è l'unico modo di tenere
            // in piedi `budget = League.budget + creditAdjustment - speso`.
            creditAdjustment: { increment: refund - released.price },
          },
        }),
      ]);
      s.participants = participants;
      s.releases = [released, ...s.releases];

      this.note('release', {
        participantId,
        player: player ?? undefined,
        role: released.role,
        price: refund,
        detail: `pagato ${released.price}`,
      });
      this.bus?.broadcast(EV.RELEASED, { ...released, undone: false });
      this.pushBudget(participantId);
      this.pushState();
      this.log.log(
        `${released.teamName} svincola ${released.name} (pagato ${released.price}, rimborso ${refund})`,
      );
    });
  }

  /**
   * Annulla un taglio, finché la finestra è aperta. Il calciatore torna in rosa
   * al prezzo di prima e il rimborso esce dai crediti: la riga `Release` porta
   * tutti e due i numeri, quindi il giro è esatto anche con rimborsi che non
   * coincidono col prezzo pagato.
   */
  unrelease(participantId: string, playerId: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      const verdict = canUnrelease(s, participantId, playerId);
      this.check(verdict);
      const release = s.releases.find(
        (r) => r.playerId === playerId && r.participantId === participantId,
      )!;

      const { participants } = applyUnrelease(s, release);
      const owner = participants.find((p) => p.id === participantId)!;
      const row = await this.prisma.release.findUnique({
        where: {
          leagueId_playerId_repairRound: {
            leagueId: this.leagueId,
            playerId,
            repairRound: s.repairRound,
          },
        },
      });
      if (!row) throw new AuctionError('NOT_RELEASED', 'Svincolo già annullato.');

      try {
        await this.prisma.$transaction([
          this.prisma.release.delete({ where: { id: row.id } }),
          this.prisma.acquisition.create({
            data: {
              leagueId: this.leagueId,
              participantId,
              playerId,
              price: release.price,
              nominatedById: row.nominatedById,
            },
          }),
          this.prisma.participant.update({
            where: { id: participantId },
            data: {
              budget: owner.budget,
              creditAdjustment: { decrement: release.refund - release.price },
            },
          }),
        ]);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AuctionError('PLAYER_TAKEN', 'Calciatore già assegnato.');
        }
        throw e;
      }
      s.participants = participants;
      s.releases = s.releases.filter(
        (r) => !(r.playerId === playerId && r.participantId === participantId),
      );

      this.note('unrelease', {
        participantId,
        role: release.role,
        price: release.refund,
        detail: `${release.name} torna in rosa`,
      });
      this.bus?.broadcast(EV.RELEASED, { ...release, undone: true });
      this.pushBudget(participantId);
      this.pushState();
      this.log.log(`${release.teamName} annulla lo svincolo di ${release.name}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Turni e fasi
  // ---------------------------------------------------------------------------
  /**
   * Dove va l'asta dopo un'assegnazione, uno skip o la chiusura di un reparto.
   * **Unico punto** che decide la fase: chiamare questo, non `advanceTurn`.
   *
   * `fromIndex` è la posizione dell'ordine dei turni da cui cercare il prossimo
   * chiamante; senza, si riparte da chi è di turno adesso.
   */
  private async continueAuction(fromIndex?: number): Promise<void> {
    const s = this.state!;
    if (!s.participants.length) {
      s.status = 'IDLE';
      s.currentTurnParticipantId = '';
      await this.persistStatus('IDLE');
      this.pushState();
      return;
    }
    if (isFinished(s)) return this.finish();
    // Rose incomplete ma nessun reparto da battere (l'admin ne ha chiusi in
    // anticipo): si aprono gli svincoli invece di rimettere in giro i turni.
    if (needsFilling(s)) return this.startFilling();

    const next = fromIndex === undefined ? nextTurn(s) : turnFrom(s, fromIndex);
    if (!next) return this.startFilling(); // nessuno può chiamare: restano buchi
    s.currentTurnParticipantId = next;
    s.status = 'IDLE';
    s.lot = null;
    s.lastAssigned = null;
    await this.persistStatus('IDLE');
    this.bus?.broadcast(EV.TURN, { participantId: next });
    this.pushState();
  }

  /**
   * Apre gli svincoli: niente turni, niente timer. Ognuno completa la propria rosa
   * pescando fra i rimasti a `FILLING_PRICE`.
   */
  private async startFilling(): Promise<void> {
    const s = this.state!;
    this.clearTimers();
    s.status = 'FILLING';
    s.lot = null;
    s.lastAssigned = null;
    await this.persistStatus('FILLING');
    this.note('filling', { price: FILLING_PRICE });
    this.log.log('Svincoli aperti: rose da completare a 1 credito');
    this.pushState();
  }

  private async finish(): Promise<void> {
    const s = this.state!;
    this.clearTimers();
    s.status = 'FINISHED';
    s.lot = null;
    await this.persistStatus('FINISHED');
    this.note('finished', {});
    this.bus?.broadcast(EV.FINISHED, {});
    this.pushState();
  }

  private persistStatus(status: AuctionStatus): Promise<unknown> {
    if (!this.leagueId) return Promise.resolve();
    return this.prisma.league.update({
      where: { id: this.leagueId },
      data: { status: status as DbStatus },
    });
  }

  // ---------------------------------------------------------------------------
  // Chiamata (nominate)
  // ---------------------------------------------------------------------------
  nominate(participantId: string, playerId: number, startPrice?: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      const player = await this.findPlayer(playerId);
      const verdict = canNominate(s, participantId, player, startPrice);
      this.check(verdict);
      const price = verdict.ok ? verdict.price : startPriceFor(s.rules, player!, startPrice);
      const at = Date.now();

      s.lot = {
        player: player!,
        byParticipantId: participantId,
        price,
        bestParticipantId: participantId, // il chiamante è il primo offerente
        endsAt: at + s.rules.bidTimerSeconds * 1000,
        history: [{ participantId, price, type: 'nominate', at }],
      };
      s.status = 'BIDDING';
      s.lastAssigned = null;
      await this.persistStatus('BIDDING');

      this.note('nominate', { participantId, player: player!, price, at });
      this.bus?.broadcast(EV.NOMINATED, {
        player: s.lot.player,
        byParticipantId: participantId,
        price,
        endsAt: s.lot.endsAt,
      });
      this.pushState();
      this.startLotTimer();
    });
  }

  // ---------------------------------------------------------------------------
  // Rilancio (bid)
  // ---------------------------------------------------------------------------
  bid(participantId: string, mode: 'plus1' | 'amount', value?: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      if (!s.lot) throw new AuctionError('NOT_BIDDING', 'Nessuna asta aperta.');
      const price = mode === 'plus1' ? s.lot.price + 1 : Number(value);
      this.check(validateBid(s, participantId, price));

      const lot = s.lot;
      const at = Date.now();
      lot.price = price;
      lot.bestParticipantId = participantId;
      lot.endsAt = at + s.rules.bidTimerSeconds * 1000; // RESET del timer
      lot.history = [{ participantId, price, type: 'bid', at }, ...lot.history];

      this.note('bid', { participantId, player: lot.player, price, at });
      this.bus?.broadcast(EV.BID_BROADCAST, { participantId, price, endsAt: lot.endsAt });
      this.pushState();
      this.startLotTimer(); // riavvia il countdown
    });
  }

  // ---------------------------------------------------------------------------
  // Timer del lotto (authoritative)
  // ---------------------------------------------------------------------------
  private startLotTimer(): void {
    this.clearTimers();
    const remaining = (): number => Math.max(0, (this.state?.lot?.endsAt ?? 0) - Date.now());
    this.tickInterval = setInterval(() => {
      this.bus?.broadcast(EV.TICK, { remainingMs: remaining() });
    }, TICK_MS);
    this.lotTimeout = setTimeout(() => {
      void this.run(() => this.closeLot());
    }, remaining());
  }

  private clearTimers(): void {
    if (this.lotTimeout) clearTimeout(this.lotTimeout);
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.assignedTimeout) clearTimeout(this.assignedTimeout);
    this.lotTimeout = undefined;
    this.tickInterval = undefined;
    this.assignedTimeout = undefined;
  }

  /** Timer scaduto: il miglior offerente si aggiudica il lotto al prezzo corrente. */
  private async closeLot(): Promise<void> {
    const s = this.state;
    if (!s?.lot || s.status !== 'BIDDING') return;
    this.clearTimers();
    const lot = s.lot;
    const { participants, assigned } = applyAssignment(s);
    await this.persistPurchase(assigned, participants, lot.byParticipantId);
    s.lot = null;
    const raises = lot.history.length - 1;
    this.note('assigned', {
      participantId: assigned.participantId,
      player: lot.player,
      price: assigned.price,
      detail: raises === 1 ? '1 rilancio' : `${raises} rilanci`,
    });
    this.emitAssigned(assigned);
    this.log.log(
      `${lot.player.name} → ${assigned.teamName} per ${assigned.price} (${lot.history.length - 1} rilanci)`,
    );
    await this.holdThenContinue();
  }

  /**
   * Lascia a schermo il risultato del lotto per `ASSIGNED_HOLD_MS`, poi passa il
   * turno. La sala ha bisogno di un attimo per registrare chi ha comprato cosa.
   */
  private async holdThenContinue(): Promise<void> {
    const s = this.state!;
    s.status = 'ASSIGNED';
    await this.persistStatus('ASSIGNED');
    this.pushState();
    this.assignedTimeout = setTimeout(() => {
      void this.run(async () => {
        if (this.state?.status !== 'ASSIGNED') return; // pausa o reset nel frattempo
        await this.continueAuction();
      });
    }, ASSIGNED_HOLD_MS);
  }

  // ---------------------------------------------------------------------------
  // Svincoli finali (status FILLING)
  // ---------------------------------------------------------------------------
  /**
   * Il partecipante completa la rosa prendendo un rimasto a `FILLING_PRICE`.
   * Nessun turno, nessun timer, nessun rilancio: chi clicca prima se lo prende.
   * La coda di `run()` serializza, quindi su due richieste simultanee la seconda
   * trova il giocatore già assegnato e riceve `PLAYER_TAKEN`.
   */
  claim(participantId: string, playerId: number): Promise<void> {
    return this.run(async () => {
      const s = await this.ensure();
      const player = await this.findPlayer(playerId);
      this.check(canClaim(s, participantId, player, FILLING_PRICE));
      const { participants, assigned } = applyPurchase(s, participantId, player!, FILLING_PRICE);
      await this.persistPurchase(assigned, participants);
      this.note('claim', { participantId, player: player!, price: FILLING_PRICE });
      this.emitAssigned(assigned);
      if (isFinished(s)) return this.finish();
      this.pushState();
    });
  }

  // ---------------------------------------------------------------------------
  // Persistenza di un acquisto
  // ---------------------------------------------------------------------------
  /**
   * Scrive prima, muta lo stato in memoria dopo: se la transazione fallisce, la
   * memoria non racconta un acquisto che il DB non conosce. Il vincolo unico
   * `(leagueId, playerId)` è l'ultima rete contro la doppia assegnazione.
   */
  private async persistPurchase(
    assigned: LastAssigned,
    participants: Participant[],
    nominatedById?: string | null,
  ): Promise<void> {
    const s = this.state!;
    const winner = participants.find((p) => p.id === assigned.participantId)!;
    try {
      await this.prisma.$transaction([
        this.prisma.acquisition.create({
          data: {
            leagueId: this.leagueId,
            participantId: winner.id,
            playerId: assigned.playerId,
            price: assigned.price,
            nominatedById: nominatedById ?? null,
          },
        }),
        this.prisma.participant.update({
          where: { id: winner.id },
          data: { budget: winner.budget },
        }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AuctionError('PLAYER_TAKEN', 'Calciatore già assegnato.');
      }
      throw e;
    }
    s.participants = participants;
    s.lastAssigned = assigned;
  }

  private emitAssigned(assigned: LastAssigned): void {
    this.bus?.broadcast(EV.ASSIGNED, assigned);
    this.pushBudget(assigned.participantId);
  }

  /** Assegnazione fuori asta (admin): come un lotto chiuso, hold incluso. */
  private async settleAssignment(
    participantId: string,
    player: Player,
    price: number,
  ): Promise<void> {
    const s = this.state!;
    const { participants, assigned } = applyPurchase(s, participantId, player, price);
    await this.persistPurchase(assigned, participants);
    this.note('manual', { participantId, player, price });
    this.emitAssigned(assigned);
    if (isFinished(s)) return this.finish();
    await this.holdThenContinue();
  }

  // ---------------------------------------------------------------------------
  // Ganci per le rotte REST d'admin
  // ---------------------------------------------------------------------------
  /** Regole/partecipanti/ordine cambiati via REST: ricarica e ritrasmetti. */
  refresh(): Promise<void> {
    return this.run(async () => {
      await this.refreshFromDb();
      this.pushState();
    });
  }

  /**
   * Reset asta: azzera lotto, fase e reparti chiusi (le rose le pulisce il REST).
   * Anche la telecronaca ricomincia: la cronaca dell'asta cancellata non racconta
   * più niente di quel che si vede a schermo.
   */
  resetLive(): Promise<void> {
    return this.run(async () => {
      this.clearTimers();
      await this.refreshFromDb(); // prima: è quel che garantisce `leagueId`
      await this.logs.clear(this.leagueId);
      const s = this.state!;
      s.status = 'IDLE';
      s.lot = null;
      s.lastAssigned = null;
      s.closedRoles = [];
      s.currentTurnParticipantId = s.turnOrder[0] ?? '';
      s.repairRound = 0;
      s.releases = [];
      s.log = [];
      await this.persistStatus('IDLE');
      this.note('reset', {});
      this.pushState();
    });
  }

  /** I giocatori già assegnati in questa lega: serve al listone (`taken`). */
  async takenPlayerIds(): Promise<Set<number>> {
    const s = await this.run(() => this.ensure());
    return new Set(s.participants.flatMap((p) => p.roster.map((r) => r.playerId)));
  }

  // ---------------------------------------------------------------------------
  private async findPlayer(playerId: number): Promise<Player | undefined> {
    if (!Number.isInteger(playerId)) return undefined;
    const row = await this.prisma.player.findUnique({ where: { id: playerId } });
    return row ? toPlayerView(row) : undefined;
  }

  /** Un verdetto negativo del motore diventa un `AuctionError` per il gateway. */
  private check(verdict: Verdict): void {
    if (verdict.ok) return;
    throw new AuctionError(verdict.code, verdict.message);
  }
}

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { corsOrigins } from '../config/cors';
import { isValidAdminToken } from '../auth/admin.guard';
import { AuthService } from '../auth/auth.service';
import { AuctionService } from './auction.service';
import { isAuctionError } from './auction-error';
import { asInt, asOptionalInt, asString } from './dto/parse';
import {
  AssignManualPayload,
  AuthAck,
  AuthPayload,
  BidPayload,
  ClaimPayload,
  ErrorCode,
  EV,
  NominatePayload,
  ReleasePayload,
  ReopenLotPayload,
  StartRepairPayload,
} from './dto/events';

/** Stanza degli admin: è l'unica che riceve gli `accessCode` nello snapshot. */
const ADMIN_ROOM = 'admins';

interface SocketSession {
  participantId: string | null;
  isAdmin: boolean;
}

/**
 * Gateway realtime, namespace `/auction`. Fa **solo** trasporto: autentica,
 * valida la forma del payload e inoltra all'`AuctionService`, che è l'unico a
 * mutare lo stato e a decidere. Ogni rifiuto torna al solo socket chiamante come
 * `errorMsg` + ack negativo.
 */
@WebSocketGateway({
  namespace: '/auction',
  cors: { origin: corsOrigins(), credentials: true },
})
export class AuctionGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(AuctionGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly auction: AuctionService,
    private readonly auth: AuthService,
  ) {}

  afterInit(): void {
    this.auction.attachBroadcaster({
      // Due snapshot per due pubblici: l'admin vede i codici d'accesso, gli altri no.
      broadcastState: () => {
        const forAdmin = this.auction.snapshot(true);
        const forAll = this.auction.snapshot(false);
        if (!forAdmin || !forAll) return;
        this.server.to(ADMIN_ROOM).emit(EV.STATE, forAdmin);
        this.server.except(ADMIN_ROOM).emit(EV.STATE, forAll);
      },
      broadcast: (event, payload) => this.server.emit(event, payload),
    });
  }

  /** Alla connessione lo stato pubblico: la schermata Accesso serve i nomi squadra. */
  async handleConnection(client: Socket): Promise<void> {
    this.session(client); // inizializza `client.data`
    try {
      client.emit(EV.STATE, await this.auction.getState(false));
    } catch (e) {
      this.reject(client, 'NO_AUCTION', 'Sala non pronta, riprova.');
      this.log.warn(`Stato non disponibile alla connessione: ${(e as Error).message}`);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const { participantId } = this.session(client);
    if (participantId) await this.auction.disconnectParticipant(participantId);
  }

  // ---------------------------------------------------------------------------
  // Autenticazione — ack `{ ok, isAdmin, participantId, session? }`
  // (PLAN.md, decisioni 6 e 21)
  // ---------------------------------------------------------------------------
  /**
   * Una porta sola per quattro credenziali: `ADMIN_TOKEN`, JWT di sessione, magic
   * token del link, codice a 6 caratteri. A distinguerle è `AuthService`; qui si
   * fa trasporto — stanza, presenza, snapshot, ack.
   *
   * Si ri-autentica anche a socket già in sala: dopo una riconnessione il client
   * rimanda il suo JWT su una socket nuova, che non ha nessuna sessione in
   * `client.data`.
   */
  @SubscribeMessage(EV.AUTH)
  async onAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: AuthPayload,
  ): Promise<AuthAck> {
    const token = asString(body?.token).trim();
    if (!token) return this.fail(client, 'AUTH_FAILED', 'Serve un codice.');

    if (isValidAdminToken(token)) {
      client.data.session = { participantId: null, isAdmin: true } satisfies SocketSession;
      await client.join(ADMIN_ROOM);
      client.emit(EV.STATE, await this.auction.getState(true));
      this.log.log('Admin connesso alla regia');
      return { ok: true, isAdmin: true, participantId: null };
    }

    const outcome = await this.auth.resolve(token);
    if (outcome.kind === 'expired') {
      return this.fail(client, 'SESSION_EXPIRED', 'Sessione scaduta: riapri il tuo link.');
    }
    if (outcome.kind === 'unknown') {
      return this.fail(client, 'AUTH_FAILED', 'Codice non valido.');
    }

    const claimed = body?.participantId;
    if (claimed && claimed !== outcome.participantId) {
      return this.fail(client, 'AUTH_MISMATCH', 'Il codice non è di questa squadra.');
    }

    // Rientro sulla stessa socket: la presenza si conta una volta sola.
    const previous = this.session(client).participantId;
    if (previous && previous !== outcome.participantId) {
      await this.auction.disconnectParticipant(previous);
    }
    client.data.session = {
      participantId: outcome.participantId,
      isAdmin: false,
    } satisfies SocketSession;
    if (previous !== outcome.participantId) {
      await this.auction.connectParticipant(outcome.participantId);
    }

    client.emit(EV.STATE, await this.auction.getState(false));
    this.log.log(`${outcome.teamName} è in sala`);
    return {
      ok: true,
      isAdmin: false,
      participantId: outcome.participantId,
      ...(outcome.session ? { session: outcome.session } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Comandi partecipante
  // ---------------------------------------------------------------------------
  @SubscribeMessage(EV.NOMINATE)
  onNominate(@ConnectedSocket() client: Socket, @MessageBody() body: NominatePayload) {
    return this.asParticipant(client, (pid) =>
      this.auction.nominate(
        pid,
        asInt(body?.playerId, 'UNKNOWN_PLAYER'),
        asOptionalInt(body?.startPrice),
      ),
    );
  }

  @SubscribeMessage(EV.BID)
  onBid(@ConnectedSocket() client: Socket, @MessageBody() body: BidPayload) {
    const mode = body?.mode === 'amount' ? 'amount' : 'plus1';
    return this.asParticipant(client, (pid) =>
      this.auction.bid(
        pid,
        mode,
        mode === 'amount' ? asInt(body?.value, 'BID_INVALID') : undefined,
      ),
    );
  }

  /** Svincolo finale: prende un rimasto a prezzo fisso (solo in fase FILLING). */
  @SubscribeMessage(EV.CLAIM)
  onClaim(@ConnectedSocket() client: Socket, @MessageBody() body: ClaimPayload) {
    return this.asParticipant(client, (pid) =>
      this.auction.claim(pid, asInt(body?.playerId, 'UNKNOWN_PLAYER')),
    );
  }

  /** Taglia dalla propria rosa (solo in fase RELEASING). Il rimborso è di lega. */
  @SubscribeMessage(EV.RELEASE)
  onRelease(@ConnectedSocket() client: Socket, @MessageBody() body: ReleasePayload) {
    return this.asParticipant(client, (pid) =>
      this.auction.release(pid, asInt(body?.playerId, 'UNKNOWN_PLAYER')),
    );
  }

  /** Ripensamento: annulla un proprio taglio finché la finestra è aperta. */
  @SubscribeMessage(EV.UNRELEASE)
  onUnrelease(@ConnectedSocket() client: Socket, @MessageBody() body: ReleasePayload) {
    return this.asParticipant(client, (pid) =>
      this.auction.unrelease(pid, asInt(body?.playerId, 'UNKNOWN_PLAYER')),
    );
  }

  // ---------------------------------------------------------------------------
  // Comandi admin
  // ---------------------------------------------------------------------------
  @SubscribeMessage(EV.ADMIN_START)
  onStart(@ConnectedSocket() c: Socket) {
    return this.asAdmin(c, () => this.auction.start());
  }

  /**
   * Apre un mercato di riparazione: finestra di svincolo + ricarica opzionale di
   * crediti. La finestra la chiude poi `admin:start`.
   */
  @SubscribeMessage(EV.ADMIN_START_REPAIR)
  onStartRepair(@ConnectedSocket() c: Socket, @MessageBody() body: StartRepairPayload) {
    return this.asAdmin(c, () => this.auction.startRepair(asOptionalInt(body?.extraBudget) ?? 0));
  }

  @SubscribeMessage(EV.ADMIN_PAUSE)
  onPause(@ConnectedSocket() c: Socket) {
    return this.asAdmin(c, () => this.auction.pause());
  }

  @SubscribeMessage(EV.ADMIN_RESUME)
  onResume(@ConnectedSocket() c: Socket) {
    return this.asAdmin(c, () => this.auction.resume());
  }

  @SubscribeMessage(EV.ADMIN_SKIP)
  onSkip(@ConnectedSocket() c: Socket) {
    return this.asAdmin(c, () => this.auction.skipTurn());
  }

  /** Chiude il reparto in corso anche se incompleto; se non ne restano, apre gli svincoli. */
  @SubscribeMessage(EV.ADMIN_ADVANCE_ROLE)
  onAdvanceRole(@ConnectedSocket() c: Socket) {
    return this.asAdmin(c, () => this.auction.advanceRole());
  }

  /** Riapre un lotto chiuso: rimborsa il compratore e lo rimette all'asta. */
  @SubscribeMessage(EV.ADMIN_REOPEN_LOT)
  onReopenLot(@ConnectedSocket() c: Socket, @MessageBody() body: ReopenLotPayload) {
    return this.asAdmin(c, () => this.auction.reopenLot(asInt(body?.playerId, 'UNKNOWN_PLAYER')));
  }

  @SubscribeMessage(EV.ADMIN_ASSIGN)
  onAssign(@ConnectedSocket() c: Socket, @MessageBody() body: AssignManualPayload) {
    return this.asAdmin(c, () =>
      this.auction.assignManual(
        asInt(body?.playerId, 'UNKNOWN_PLAYER'),
        asString(body?.participantId),
        asInt(body?.price, 'BID_INVALID'),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------
  private session(client: Socket): SocketSession {
    const existing = client.data.session as SocketSession | undefined;
    if (existing) return existing;
    const fresh: SocketSession = { participantId: null, isAdmin: false };
    client.data.session = fresh;
    return fresh;
  }

  private asParticipant(client: Socket, fn: (participantId: string) => Promise<unknown>) {
    const { participantId } = this.session(client);
    if (!participantId) {
      return this.fail(client, 'NO_IDENTITY', 'Entra in sala con il codice della tua squadra.');
    }
    return this.guard(client, () => fn(participantId));
  }

  private asAdmin(client: Socket, fn: () => Promise<unknown>) {
    if (!this.session(client).isAdmin) {
      return this.fail(client, 'FORBIDDEN', 'Comando riservato all’admin.');
    }
    return this.guard(client, fn);
  }

  /** Esegue e traduce i rifiuti di dominio in `errorMsg` + ack negativo. */
  private async guard(client: Socket, fn: () => Promise<unknown>): Promise<AuthAck> {
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      if (isAuctionError(e)) return this.fail(client, e.code, e.message);
      this.log.error(`Errore non gestito: ${(e as Error).message}`, (e as Error).stack);
      return this.fail(client, 'NO_AUCTION', 'Errore del server. Riprova.');
    }
  }

  private fail(client: Socket, code: ErrorCode, message: string): AuthAck {
    this.reject(client, code, message);
    return { ok: false, code, message };
  }

  private reject(client: Socket, code: ErrorCode, message: string): void {
    client.emit(EV.ERROR, { code, message });
  }
}

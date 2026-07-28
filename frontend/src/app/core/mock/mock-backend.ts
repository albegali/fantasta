/**
 * Mock backend: stand-in in-memory e *server-authoritative* di NestJS + Socket.IO.
 * Port di `mock/mock-backend.js`. Stessi nomi d'evento e payload di CLAUDE.md §5,
 * così passare al gateway reale è solo un cambio di trasporto.
 *
 *   const { socket, api } = createMockBackend();
 *   socket.on('state', (s) => …);
 *   socket.emit('auth', { token: '7KQ2MX' }, (ack) => …);
 *
 * Tutto quello che c'è qui è usa-e-getta: serve a sviluppare e demoare offline
 * (`environment.useMock`). `simulateOpponents` fa nominare e rilanciare gli
 * avversari, così la sala è viva anche con un solo browser aperto.
 */

import {
  Ack,
  ApiPort,
  ImportResult,
  LastImport,
  LogQuery,
  ParticipantPatch,
  PlayerQuery,
  RostersExport,
  SocketPort,
} from '../ports';
import {
  AuctionLogEntry,
  AuctionLogType,
  AuctionRules,
  AuctionState,
  AuthAck,
  BidPayload,
  ClaimPayload,
  FILLING_PRICE,
  LOG_TAIL,
  Participant,
  Player,
  PlayerRow,
  AssignManualPayload,
  ErrorCode,
  NominatePayload,
  ReleasePayload,
  ReopenLotPayload,
  Role,
  SessionToken,
  StartRepairPayload,
} from '../auction-events';
import { ROLE_LABEL_PLURAL } from '../../shared/ui';
import { ADMIN_TOKEN, DEFAULT_RULES, SEED_PARTICIPANTS, SEED_PLAYERS } from './data.mock';
import * as E from './auction-engine';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const LATENCY = 25;

/** Prefisso delle sessioni finte: distingue un JWT (finto) da un codice squadra. */
const SESSION_PREFIX = 'mock-session.';
/** Come `SESSION_TTL_DAYS` sul server. */
const MOCK_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MockBackend {
  socket: SocketPort;
  api: ApiPort;
}

export interface MockOptions {
  simulateOpponents?: boolean;
  tickMs?: number;
}

let INSTANCE: MockBackend | null = null;

/** Singleton: più mount del client parlano con lo stesso "server". */
export function createMockBackend(opts: MockOptions = {}): MockBackend {
  INSTANCE ??= buildMockBackend(opts);
  return INSTANCE;
}

type Listener = (payload: never) => void;
interface Session {
  participantId: string | null;
  isAdmin: boolean;
}

function buildMockBackend(opts: MockOptions): MockBackend {
  const simulateOpponents = opts.simulateOpponents !== false;
  const tickMs = opts.tickMs || 250;

  const initialState: AuctionState = {
    // IDLE | BIDDING | ASSIGNED | PAUSED | RELEASING | FILLING | FINISHED
    status: 'IDLE',
    rules: clone(DEFAULT_RULES),
    participants: clone(SEED_PARTICIPANTS),
    turnOrder: SEED_PARTICIPANTS.map((p) => p.id),
    currentTurnParticipantId: SEED_PARTICIPANTS[0].id,
    currentRole: null,
    closedRoles: [],
    lot: null,
    lastAssigned: null,
    repairRound: 0,
    releases: [],
    log: [],
  };
  const initialImport: LastImport = {
    filename: 'Listone_Fantacalcio_2025-26.xlsx',
    at: '27/07',
    count: SEED_PLAYERS.length,
  };

  const store = {
    players: clone(SEED_PLAYERS),
    lastImport: initialImport,
    state: initialState,
    /** Telecronaca completa, la più recente in testa: sul server è una tabella. */
    log: [] as AuctionLogEntry[],
    logSeq: 0,
  };

  const listeners = new Map<string, Listener[]>();
  const sessions = new Map<string, Session>();
  let botValuations: Record<string, number> = {};
  let assignedAt = 0;
  /** Chi aveva chiamato un lotto già chiuso: sul server è `Acquisition.nominatedById`. */
  const nominatedBy = new Map<number, string>();

  const emitToClients = (event: string, payload?: unknown): void => {
    const fns = listeners.get(event);
    if (!fns) return;
    const data = payload === undefined ? undefined : clone(payload);
    setTimeout(() => fns.slice().forEach((fn) => (fn as (p: unknown) => void)(data)), LATENCY);
  };

  const snapshot = (): AuctionState => ({
    ...clone(store.state),
    currentRole: E.currentRole(store.state),
  });
  const pushState = (): void => emitToClients('state', snapshot());

  const pushBudget = (participantId: string): void => {
    const p = store.state.participants.find((x) => x.id === participantId);
    if (!p) return;
    emitToClients('budgetUpdated', {
      participantId,
      budget: p.budget,
      slots: E.slotsUsed(p),
      maxBid: E.computeMaxBid(p, store.state.rules),
    });
  };

  /**
   * Aggiunge una riga di telecronaca. Come sul server (`AuctionService.note`):
   * nomi denormalizzati, e nello `state` finisce solo la coda recente.
   */
  function note(
    type: AuctionLogType,
    opts: {
      participantId?: string | null;
      player?: Player;
      role?: Role | null;
      price?: number | null;
      detail?: string | null;
    } = {},
  ): void {
    store.logSeq += 1;
    const participantId = opts.participantId ?? null;
    const entry: AuctionLogEntry = {
      seq: store.logSeq,
      type,
      at: Date.now(),
      participantId,
      teamName: participantId
        ? (store.state.participants.find((p) => p.id === participantId)?.teamName ?? null)
        : null,
      playerId: opts.player?.id ?? null,
      playerName: opts.player?.name ?? null,
      role: opts.player?.role ?? opts.role ?? null,
      price: opts.price ?? null,
      detail: opts.detail ?? null,
    };
    store.log = [entry, ...store.log];
    store.state.log = store.log.slice(0, LOG_TAIL);
  }

  /** Quanto vale il lotto per ciascun avversario simulato: deciso all'apertura. */
  function setBotValuations(player: Player): void {
    botValuations = {};
    for (const p of store.state.participants) {
      const want = E.needsRole(p, store.state.rules, player.role) ? 0.7 + Math.random() * 0.9 : 0;
      botValuations[p.id] = Math.min(
        E.computeMaxBid(p, store.state.rules),
        Math.round(player.quotation * want),
      );
    }
  }

  // ── mutazioni serializzate (sul server reale: una coda per auctionId) ──
  function nominate(
    participantId: string | null,
    playerId: number,
    startPrice?: number,
  ): E.Verdict {
    const player = store.players.find((p) => p.id === playerId);
    const verdict = E.canNominate(store.state, participantId, player, startPrice);
    if (!verdict.ok) return verdict;
    const at = Date.now();
    store.state.lot = {
      player: clone(player!),
      byParticipantId: participantId!,
      price: verdict.price,
      bestParticipantId: participantId!,
      endsAt: at + store.state.rules.bidTimerSeconds * 1000,
      history: [{ participantId: participantId!, price: verdict.price, type: 'nominate', at }],
    };
    store.state.status = 'BIDDING';
    setBotValuations(player!);
    note('nominate', { participantId, player: player!, price: verdict.price });
    emitToClients('nominated', {
      player: clone(player!),
      byParticipantId: participantId,
      price: store.state.lot.price,
      endsAt: store.state.lot.endsAt,
    });
    pushState();
    return verdict;
  }

  function bid(participantId: string | null, price: number): E.Verdict {
    const verdict = E.validateBid(store.state, participantId, price);
    if (!verdict.ok) return verdict;
    const lot = store.state.lot!;
    lot.price = price;
    lot.bestParticipantId = participantId!;
    lot.endsAt = Date.now() + store.state.rules.bidTimerSeconds * 1000;
    lot.history.unshift({ participantId: participantId!, price, type: 'bid', at: Date.now() });
    note('bid', { participantId, player: lot.player, price });
    emitToClients('bid', { participantId, price, endsAt: lot.endsAt });
    pushState();
    return verdict;
  }

  /** `kind` distingue il lotto battuto dall'assegnazione a mano dell'admin. */
  function closeLot(kind: 'assigned' | 'manual' = 'assigned'): void {
    const lot = store.state.lot;
    const { participants, assigned } = E.applyAssignment(store.state);
    if (lot) nominatedBy.set(lot.player.id, lot.byParticipantId);
    store.state.participants = participants;
    store.state.lastAssigned = assigned;
    store.state.status = 'ASSIGNED';
    store.state.lot = null;
    assignedAt = Date.now();
    if (lot) {
      const raises = Math.max(0, lot.history.length - 1);
      note(kind, {
        participantId: assigned.participantId,
        player: lot.player,
        price: assigned.price,
        detail: kind === 'assigned' ? (raises === 1 ? '1 rilancio' : `${raises} rilanci`) : null,
      });
    }
    emitToClients('assigned', assigned);
    pushBudget(assigned.participantId);
    pushState();
  }

  /**
   * Dove va l'asta dopo un'assegnazione o la chiusura di un reparto. Unico punto
   * che decide la fase, come `continueAuction` sul backend.
   */
  function advanceTurn(): void {
    if (E.isFinished(store.state)) {
      store.state.status = 'FINISHED';
      note('finished');
      emitToClients('finished', {});
      pushState();
      return;
    }
    // Rose incomplete ma nessun reparto da battere (l'admin ne ha chiusi in
    // anticipo): si aprono gli svincoli invece di rimettere in giro i turni.
    if (E.needsFilling(store.state)) {
      store.state.status = 'FILLING';
      store.state.lot = null;
      store.state.lastAssigned = null;
      note('filling', { price: FILLING_PRICE });
      pushState();
      return;
    }
    const next = E.nextTurn(store.state);
    store.state.currentTurnParticipantId = next ?? store.state.turnOrder[0];
    store.state.status = 'IDLE';
    store.state.lastAssigned = null;
    emitToClients('turn', { participantId: next });
    pushState();
  }

  /** Svincolo: assegnazione diretta a prezzo fisso, senza lotto né turni. */
  function claim(participantId: string | null, playerId: number): E.Verdict {
    const player = store.players.find((p) => p.id === playerId);
    const verdict = E.canClaim(store.state, participantId, player, FILLING_PRICE);
    if (!verdict.ok) return verdict;
    const { participants, assigned } = E.applyClaim(
      store.state,
      participantId!,
      player!,
      FILLING_PRICE,
    );
    store.state.participants = participants;
    note('claim', { participantId: participantId!, player: player!, price: FILLING_PRICE });
    emitToClients('assigned', assigned);
    pushBudget(assigned.participantId);
    if (E.isFinished(store.state)) {
      store.state.status = 'FINISHED';
      note('finished');
      emitToClients('finished', {});
    }
    pushState();
    return verdict;
  }

  /**
   * Riapre un lotto già chiuso: rimborsa il compratore e si ribatte dal prezzo
   * base. Stesse regole del server (CLAUDE.md §4): la chiamata torna a chi
   * l'aveva fatta se ha ancora slot e crediti, altrimenti la tiene il compratore;
   * a sala in pausa il timer non riparte (ci pensa `admin:resume`).
   */
  function reopenLot(playerId: number): E.Verdict {
    const st = store.state;
    if (st.lot) return { ok: false, code: 'LOT_OPEN', message: 'Chiudi prima il lotto in corso.' };
    const player = store.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, code: 'UNKNOWN_PLAYER', message: 'Calciatore sconosciuto.' };
    const buyer = st.participants.find((p) => p.roster.some((r) => r.playerId === playerId));
    if (!buyer) {
      return { ok: false, code: 'NOT_ASSIGNED', message: 'Questo calciatore non è assegnato.' };
    }

    const { participants, price: refunded } = E.applyRefund(st, buyer.id, playerId);
    st.participants = participants;

    const price = E.startPriceFor(st.rules, player);
    const caller = [nominatedBy.get(playerId), buyer.id].find((id) =>
      E.canHoldLot(st, id, player, price),
    );
    if (!caller) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CREDITS',
        message: `Nessuno può tenere il lotto a ${price}: assegnalo a mano.`,
      };
    }
    nominatedBy.delete(playerId);

    const at = Date.now();
    st.lot = {
      player: clone(player),
      byParticipantId: caller,
      price,
      bestParticipantId: caller,
      endsAt: at + st.rules.bidTimerSeconds * 1000,
      history: [{ participantId: caller, price, type: 'nominate', at }],
    };
    st.currentTurnParticipantId = caller;
    st.lastAssigned = null;
    if (st.status !== 'PAUSED') st.status = 'BIDDING';
    setBotValuations(player);
    note('reopen', {
      participantId: buyer.id,
      player,
      price: refunded,
      detail: `si ribatte da ${price}`,
    });
    emitToClients('nominated', {
      player: clone(player),
      byParticipantId: caller,
      price,
      endsAt: st.lot.endsAt,
    });
    pushBudget(buyer.id);
    pushState();
    return { ok: true, price: refunded };
  }

  /**
   * Apre un mercato di riparazione: finestra di svincolo + ricarica opzionale.
   * Stesse regole del server (`AuctionService.startRepair`): i reparti chiusi si
   * riaprono, `repairRound` avanza, la chiude poi `admin:start`.
   */
  function startRepair(extraBudget: number): E.Verdict {
    const st = store.state;
    if (st.lot) return { ok: false, code: 'LOT_OPEN', message: 'Chiudi prima il lotto in corso.' };
    if (st.status === 'RELEASING') {
      return { ok: false, code: 'NOT_IDLE', message: 'C’è già un mercato aperto.' };
    }
    if (!Number.isInteger(extraBudget) || extraBudget < 0) {
      return { ok: false, code: 'BID_INVALID', message: 'La ricarica di crediti non è valida.' };
    }
    st.repairRound += 1;
    st.closedRoles = [];
    st.releases = [];
    st.lot = null;
    st.lastAssigned = null;
    st.status = 'RELEASING';
    if (extraBudget > 0) {
      st.participants = st.participants.map((p) => ({ ...p, budget: p.budget + extraBudget }));
    }
    note('repairStart', {
      detail:
        extraBudget > 0
          ? `round ${st.repairRound}, +${extraBudget} crediti a tutti`
          : `round ${st.repairRound}`,
      price: extraBudget || null,
    });
    for (const p of st.participants) pushBudget(p.id);
    pushState();
    return { ok: true, price: extraBudget };
  }

  /** Taglio dalla propria rosa: il rimborso lo decide `rules.releaseRefund`. */
  function release(participantId: string | null, playerId: number): E.Verdict {
    const st = store.state;
    const me = st.participants.find((p) => p.id === participantId);
    const entry = me?.roster.find((r) => r.playerId === playerId);
    const quotation = store.players.find((p) => p.id === playerId)?.quotation ?? entry?.price ?? 0;
    const refund = entry ? E.refundFor(st.rules.releaseRefund, entry.price, quotation) : 0;
    const verdict = E.canRelease(st, participantId, playerId, refund);
    if (!verdict.ok) return verdict;

    const { participants, released } = E.applyRelease(st, participantId!, playerId, refund);
    st.participants = participants;
    st.releases = [released, ...st.releases];
    // Il calciatore torna libero: chi l'aveva chiamato non c'entra più niente.
    nominatedBy.delete(playerId);
    note('release', {
      participantId: participantId!,
      player: store.players.find((p) => p.id === playerId),
      role: released.role,
      price: refund,
      detail: `pagato ${released.price}`,
    });
    emitToClients('released', { ...released, undone: false });
    pushBudget(participantId!);
    pushState();
    return verdict;
  }

  /** Annulla un proprio taglio, finché la finestra è aperta. */
  function unrelease(participantId: string | null, playerId: number): E.Verdict {
    const st = store.state;
    const verdict = E.canUnrelease(st, participantId, playerId);
    if (!verdict.ok) return verdict;
    const rel = st.releases.find(
      (r) => r.playerId === playerId && r.participantId === participantId,
    )!;
    st.participants = E.applyUnrelease(st, rel).participants;
    st.releases = st.releases.filter(
      (r) => !(r.playerId === playerId && r.participantId === participantId),
    );
    note('unrelease', {
      participantId: participantId!,
      role: rel.role,
      price: rel.refund,
      detail: `${rel.name} torna in rosa`,
    });
    emitToClients('released', { ...rel, undone: true });
    pushBudget(participantId!);
    pushState();
    return verdict;
  }

  /**
   * L'admin chiude il reparto in corso e passa al successivo anche se incompleto.
   * Gli slot rimasti non tornano all'asta: si riempiono negli svincoli.
   */
  function advanceRole(): E.Verdict {
    const st = store.state;
    if (st.lot) return { ok: false, code: 'LOT_OPEN', message: 'Chiudi prima il lotto in corso.' };
    if (st.rules.callOrder !== 'fixed') {
      return {
        ok: false,
        code: 'NOT_FIXED_ORDER',
        message: 'I reparti esistono solo con ordine per reparto.',
      };
    }
    if (E.isFinished(st)) {
      return { ok: false, code: 'ALREADY_COMPLETE', message: 'Le rose sono già complete.' };
    }
    const role = E.currentRole(st);
    if (role) {
      const leftover = E.remainingSlotsInRole(st, role);
      st.closedRoles = [...st.closedRoles, role];
      note('roleClosed', {
        role,
        detail: `${ROLE_LABEL_PLURAL[role]}, ${leftover} slot lasciati vuoti`,
      });
    }
    advanceTurn();
    return { ok: true, price: 0 };
  }

  // ── loop del "server" ──
  let botThinkUntil = 0;
  setInterval(() => {
    const st = store.state;
    if (st.status === 'RELEASING' && simulateOpponents && sessions.size > 0) {
      botMaybeRelease();
      return;
    }
    if (st.status === 'FILLING' && simulateOpponents && sessions.size > 0) {
      botMaybeClaim();
      return;
    }
    if (st.status === 'BIDDING' && st.lot) {
      const remainingMs = Math.max(0, st.lot.endsAt - Date.now());
      emitToClients('tick', { remainingMs });
      if (remainingMs <= 0) {
        closeLot();
        return;
      }
      if (simulateOpponents && sessions.size > 0) botMaybeBid();
      return;
    }
    if (st.status === 'ASSIGNED' && Date.now() - assignedAt > 2400) {
      advanceTurn();
      return;
    }
    // Gli avversari simulati si muovono solo a sala aperta (≥1 sessione autenticata).
    if (st.status === 'IDLE' && simulateOpponents && sessions.size > 0) {
      const turnId = st.currentTurnParticipantId;
      const isHuman = [...sessions.values()].some((s) => s.participantId === turnId);
      if (isHuman) {
        botThinkUntil = 0;
        return;
      }
      if (!botThinkUntil) {
        botThinkUntil = Date.now() + 2400;
        return;
      }
      if (Date.now() >= botThinkUntil) {
        botThinkUntil = 0;
        botNominate(turnId);
      }
    }
  }, tickMs);

  function botNominate(participantId: string): void {
    const st = store.state;
    const p = st.participants.find((x) => x.id === participantId);
    if (!p) return;
    const role = E.currentRole(st);
    const pool = store.players.filter(
      (pl) =>
        !E.isPlayerTaken(st, pl.id) &&
        E.needsRole(p, st.rules, pl.role) &&
        (!role || pl.role === role) &&
        E.startPriceFor(st.rules, pl) <= E.computeMaxBid(p, st.rules),
    );
    if (!pool.length) {
      advanceTurn();
      return;
    }
    const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 10))];
    nominate(participantId, pick.id);
  }

  /**
   * A finestra di svincolo aperta gli avversari simulati tagliano qualcuno, piano:
   * serve a far vedere la lista degli svincolati riempirsi mentre l'umano decide.
   * Si fermano a `BOT_MAX_CUTS` a testa, altrimenti si svuoterebbero le rose.
   */
  function botMaybeRelease(): void {
    const st = store.state;
    if (Math.random() > 0.12) return;
    const humans = new Set([...sessions.values()].map((s) => s.participantId));
    const BOT_MAX_CUTS = 2;
    const bot = st.participants.find(
      (p) =>
        !humans.has(p.id) &&
        p.roster.length > 0 &&
        st.releases.filter((r) => r.participantId === p.id).length < BOT_MAX_CUTS,
    );
    if (!bot) return;
    // Taglia il più caro: è la scelta che rende la riparazione interessante da guardare.
    const worst = [...bot.roster].sort((a, b) => b.price - a.price)[0];
    release(bot.id, worst.playerId);
  }

  /**
   * Negli svincoli gli avversari simulati pescano piano, così il partecipante umano
   * ha il tempo di scegliere invece di trovare la lista già svuotata.
   */
  function botMaybeClaim(): void {
    const st = store.state;
    if (Math.random() > 0.25) return;
    const humans = new Set([...sessions.values()].map((s) => s.participantId));
    const bot = st.participants.find(
      (p) => !humans.has(p.id) && E.slotsLeft(p, st.rules) > 0 && p.budget >= FILLING_PRICE,
    );
    if (!bot) return;
    const pick = store.players.find(
      (pl) => !E.isPlayerTaken(st, pl.id) && E.needsRole(bot, st.rules, pl.role),
    );
    if (pick) claim(bot.id, pick.id);
  }

  function botMaybeBid(): void {
    const st = store.state;
    const lot = st.lot!;
    const remaining = lot.endsAt - Date.now();
    if (Math.random() > (remaining < 2000 ? 0.32 : 0.14)) return;
    const humans = new Set([...sessions.values()].map((s) => s.participantId));
    const cand = st.participants.filter(
      (p) =>
        !humans.has(p.id) &&
        p.online &&
        p.id !== lot.bestParticipantId &&
        E.needsRole(p, st.rules, lot.player.role) &&
        (botValuations[p.id] || 0) > lot.price &&
        E.computeMaxBid(p, st.rules) > lot.price,
    );
    if (!cand.length) return;
    const b = cand[Math.floor(Math.random() * cand.length)];
    const step = [1, 1, 1, 2, 3, 5][Math.floor(Math.random() * 6)];
    const price = Math.min(lot.price + step, botValuations[b.id], E.computeMaxBid(b, st.rules));
    if (price > lot.price) bid(b.id, price);
  }

  // ── client socket-like ──
  /**
   * A finestra di svincolo aperta i comandi d'asta vanno rifiutati, non eseguiti a
   * vuoto: come sul server (`AuctionService.refuseDuringReleasing`).
   */
  const releasingOpen = (): boolean => store.state.status === 'RELEASING';
  const releasingRefusal = (what: string): { code: ErrorCode; message: string } => ({
    code: 'NOT_IDLE',
    message: `Finestra di svincolo aperta: ${what}`,
  });

  // ── sessioni finte ──
  // Il server firma un JWT; qui basta una stringa che porti con sé identità e
  // generazione delle credenziali, così anche nel mock rigenerare un link o un
  // codice butta giù le sessioni aperte di quella squadra.
  const tokenVersions = new Map<string, number>();
  const revokeSessions = (participantId: string): void => {
    tokenVersions.set(participantId, (tokenVersions.get(participantId) ?? 0) + 1);
  };
  const mockSession = (participantId: string): SessionToken => ({
    token: `${SESSION_PREFIX}${participantId}.${tokenVersions.get(participantId) ?? 0}`,
    expiresAt: Date.now() + MOCK_SESSION_TTL_MS,
  });
  const sessionTokenOwner = (token: string): string | null => {
    if (!token.startsWith(SESSION_PREFIX)) return null;
    const [participantId, version] = token.slice(SESSION_PREFIX.length).split('.');
    return (tokenVersions.get(participantId) ?? 0) === Number(version) ? participantId : null;
  };

  const socketId = `mock-${Date.now()}`;
  const socket: SocketPort = {
    connect(): void {
      /* il mock è sempre "connesso" */
    },
    on<T>(event: string, handler: (payload: T) => void): void {
      listeners.set(event, [...(listeners.get(event) ?? []), handler as Listener]);
    },
    off<T>(event: string, handler: (payload: T) => void): void {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((f) => f !== (handler as Listener)),
      );
    },
    // Il loop è del "server": un client che si disconnette non lo ferma.
    disconnect(): void {
      sessions.delete(socketId);
      listeners.clear();
    },
    emit<A = unknown>(event: string, payload: unknown = {}, ack?: Ack<A>): void {
      const session = sessions.get(socketId) ?? { participantId: null, isAdmin: false };
      const fail = (v: { code: string; message: string }): void => {
        emitToClients('errorMsg', { code: v.code, message: v.message });
        ack?.({ ok: false, ...v } as A);
      };
      const done = (v: object): void => ack?.({ ok: true, ...v } as A);
      setTimeout(() => {
        switch (event) {
          case 'auth': {
            const { token, participantId } = payload as { token?: string; participantId?: string };
            const raw = String(token ?? '').trim();
            if (raw.toUpperCase() === ADMIN_TOKEN) {
              sessions.set(socketId, { participantId: null, isAdmin: true });
              pushState();
              return done({ isAdmin: true, participantId: null } satisfies Partial<AuthAck>);
            }
            // Tre credenziali come sul server: sessione salvata, magic token del
            // link, codice a 6 caratteri (`AuthService.resolve`).
            const p = store.state.participants.find(
              (x) =>
                x.magicToken === raw ||
                x.accessCode === raw.toUpperCase() ||
                sessionTokenOwner(raw) === x.id,
            );
            if (!p) {
              return raw.startsWith(SESSION_PREFIX)
                ? fail({
                    code: 'SESSION_EXPIRED',
                    message: 'Sessione scaduta: riapri il tuo link.',
                  })
                : fail({ code: 'AUTH_FAILED', message: 'Codice non valido.' });
            }
            if (participantId && participantId !== p.id) {
              return fail({ code: 'AUTH_MISMATCH', message: 'Il codice non è di questa squadra.' });
            }
            sessions.set(socketId, { participantId: p.id, isAdmin: false });
            p.online = true;
            pushState();
            return done({
              isAdmin: false,
              participantId: p.id,
              session: mockSession(p.id),
            } satisfies Partial<AuthAck>);
          }
          case 'nominate': {
            const { playerId, startPrice } = payload as NominatePayload;
            const v = nominate(session.participantId, playerId, startPrice);
            return v.ok ? done(v) : fail(v);
          }
          case 'bid': {
            const lot = store.state.lot;
            if (!lot) return fail({ code: 'NOT_BIDDING', message: 'Nessuna asta aperta.' });
            const { mode, value } = payload as BidPayload;
            const price = mode === 'plus1' ? lot.price + 1 : Number(value);
            const v = bid(session.participantId, price);
            return v.ok ? done(v) : fail(v);
          }
          case 'claim': {
            const { playerId } = payload as ClaimPayload;
            const v = claim(session.participantId, playerId);
            return v.ok ? done(v) : fail(v);
          }
          case 'release': {
            const { playerId } = payload as ReleasePayload;
            const v = release(session.participantId, playerId);
            return v.ok ? done(v) : fail(v);
          }
          case 'unrelease': {
            const { playerId } = payload as ReleasePayload;
            const v = unrelease(session.participantId, playerId);
            return v.ok ? done(v) : fail(v);
          }
          case 'admin:startRepair': {
            const { extraBudget } = payload as StartRepairPayload;
            const v = startRepair(Number(extraBudget ?? 0));
            return v.ok ? done({}) : fail(v);
          }
          case 'admin:advanceRole': {
            const v = advanceRole();
            return v.ok ? done({}) : fail(v);
          }
          case 'admin:reopenLot': {
            const { playerId } = payload as ReopenLotPayload;
            const v = reopenLot(playerId);
            return v.ok ? done({}) : fail(v);
          }
          case 'admin:pause':
            if (releasingOpen())
              return fail(releasingRefusal('non c’è niente da mettere in pausa.'));
            store.state.status = 'PAUSED';
            note('pause', { player: store.state.lot?.player });
            pushState();
            return done({});
          case 'admin:resume':
            store.state.status = store.state.lot ? 'BIDDING' : 'IDLE';
            if (store.state.lot) {
              store.state.lot.endsAt = Date.now() + store.state.rules.bidTimerSeconds * 1000;
            }
            note('resume', { player: store.state.lot?.player });
            pushState();
            return done({});
          case 'admin:skipTurn': {
            if (releasingOpen()) return fail(releasingRefusal('non c’è nessun turno da saltare.'));
            const cancelled = store.state.lot;
            store.state.lot = null;
            note('skip', {
              participantId: store.state.currentTurnParticipantId,
              player: cancelled?.player,
              price: cancelled?.price,
              detail: cancelled ? 'lotto annullato' : null,
            });
            advanceTurn();
            return done({});
          }
          /**
           * È anche il comando che **chiude la finestra di svincolo**: da lì i tagli
           * sono definitivi e `advanceTurn` porta il turno su chi ha davvero un buco.
           */
          case 'admin:start': {
            const closingWindow = store.state.status === 'RELEASING';
            store.state.status = 'IDLE';
            note('start', {
              detail: closingWindow
                ? `riparazione ${store.state.repairRound}: ${store.state.releases.length} svincoli, si riparte`
                : store.state.rules.auctionName,
            });
            if (closingWindow) advanceTurn();
            else pushState();
            return done({});
          }
          case 'admin:assignManual': {
            if (releasingOpen()) {
              return fail(releasingRefusal('chiudila prima di assegnare a mano.'));
            }
            const { playerId, participantId, price } = payload as AssignManualPayload;
            const player = store.players.find((p) => p.id === playerId);
            if (!player)
              return fail({ code: 'UNKNOWN_PLAYER', message: 'Calciatore sconosciuto.' });
            store.state.lot = {
              player: clone(player),
              byParticipantId: participantId,
              price,
              bestParticipantId: participantId,
              endsAt: Date.now(),
              history: [],
            };
            closeLot('manual');
            return done({});
          }
          default:
            return fail({ code: 'UNKNOWN_EVENT', message: `Evento sconosciuto: ${event}` });
        }
      }, LATENCY);
    },
  };

  // ── REST mock ──
  const wait = <T>(v: T): Promise<T> =>
    new Promise((res) => setTimeout(() => res(clone(v)), LATENCY * 3));

  const randomCode = (): string => {
    let c = '';
    for (let i = 0; i < 6; i += 1) {
      c += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)];
    }
    return c;
  };

  /** Il server usa `randomBytes`; qui basta che sia diverso ogni volta. */
  const randomMagicToken = (): string =>
    `mock-link-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const api: ApiPort = {
    getState: () => wait(snapshot()),
    getRules: () => wait(store.state.rules),
    putRules: (patch: Partial<AuctionRules>) => {
      const before = store.state.rules.budget;
      store.state.rules = { ...store.state.rules, ...patch };
      if (patch.budget != null && patch.budget !== before) {
        store.state.participants = store.state.participants.map((p) => ({
          ...p,
          budget: patch.budget! - p.spent,
        }));
      }
      pushState();
      return wait(store.state.rules);
    },
    listPlayers: ({
      q = '',
      role = null,
      available = false,
      taken = false,
      take = 50,
    }: PlayerQuery = {}) => {
      const needle = q.trim().toLowerCase();
      const rows: PlayerRow[] = store.players
        .map((p) => ({ ...p, taken: E.isPlayerTaken(store.state, p.id) }))
        .filter(
          (p) =>
            (!role || p.role === role) &&
            (!available || !p.taken) &&
            // `available` vince su `taken` se arrivano entrambi, come sul server.
            (available || !taken || p.taken) &&
            (!needle ||
              p.name.toLowerCase().includes(needle) ||
              p.team.toLowerCase().includes(needle)),
        )
        // Ordina PRIMA di tagliare: `take` deve dare i più quotati, non i primi
        // che capitano nel listone.
        .sort((a, b) => b.quotation - a.quotation || a.name.localeCompare(b.name))
        .slice(0, take);
      return wait(rows);
    },
    getLastImport: () => wait(store.lastImport),
    importPlayers: (file: File) => {
      store.lastImport = {
        filename: file?.name || 'listone.xlsx',
        at: new Date().toLocaleDateString('it-IT'),
        count: store.players.length,
      };
      return wait<ImportResult>({
        imported: 0,
        updated: store.players.length,
        total: store.players.length,
      });
    },
    listParticipants: () => wait(store.state.participants),
    upsertParticipant: (patch: ParticipantPatch) => {
      const i = store.state.participants.findIndex((x) => x.id === patch.id);
      if (i < 0) {
        const created: Participant = {
          id: `p${store.state.participants.length + 1}-${Date.now()}`,
          name: patch.name || 'Nuovo',
          teamName: patch.teamName || 'Squadra senza nome',
          accessCode: randomCode(),
          magicToken: randomMagicToken(),
          avatarUrl: null,
          color: '#9397ab',
          budget: store.state.rules.budget,
          spent: 0,
          roster: [],
          online: false,
        };
        store.state.participants.push(created);
        store.state.turnOrder.push(created.id);
      } else {
        store.state.participants[i] = { ...store.state.participants[i], ...patch };
      }
      pushState();
      return wait(store.state.participants);
    },
    deleteParticipant: (participantId: string) => {
      store.state.participants = store.state.participants.filter((x) => x.id !== participantId);
      store.state.turnOrder = store.state.turnOrder.filter((id) => id !== participantId);
      if (store.state.currentTurnParticipantId === participantId) {
        store.state.currentTurnParticipantId = store.state.turnOrder[0];
      }
      pushState();
      return wait(store.state.participants);
    },
    setTurnOrder: (ids: string[]) => {
      store.state.turnOrder = [...ids];
      store.state.participants.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      pushState();
      return wait(store.state.turnOrder);
    },
    regenerateCode: (participantId: string) => {
      const p = store.state.participants.find((x) => x.id === participantId);
      if (p) {
        p.accessCode = randomCode();
        revokeSessions(p.id);
      }
      pushState();
      return wait(p ?? null);
    },
    regenerateLink: (participantId: string) => {
      const p = store.state.participants.find((x) => x.id === participantId);
      if (p) {
        p.magicToken = randomMagicToken();
        revokeSessions(p.id);
      }
      pushState();
      return wait(p ?? null);
    },
    resetAuction: () => {
      store.state.participants = store.state.participants.map((p) => ({
        ...p,
        budget: store.state.rules.budget,
        spent: 0,
        roster: [],
      }));
      store.state.lot = null;
      store.state.lastAssigned = null;
      store.state.status = 'IDLE';
      store.state.closedRoles = [];
      store.state.repairRound = 0;
      store.state.releases = [];
      store.state.currentTurnParticipantId = store.state.turnOrder[0];
      // Come sul server: la cronaca dell'asta azzerata non racconta più niente.
      store.log = [];
      store.logSeq = 0;
      store.state.log = [];
      note('reset');
      pushState();
      return wait(snapshot());
    },
    getLog: ({ take = 200, before, types, participantId }: LogQuery = {}) => {
      const rows = store.log
        .filter(
          (e) =>
            (before === undefined || e.seq < before) &&
            (!types?.length || types.includes(e.type)) &&
            (!participantId || e.participantId === participantId),
        )
        .slice(0, take);
      return wait(rows);
    },
    /**
     * Stesso formato del server (`backend/src/export/rosters-csv.ts`): separatore
     * `$,$,$` per blocco-squadra e righe `squadra,idCalciatore,prezzo`. Il listone
     * finto non ha gli id di Fantacalcio.it, quindi qui va in colonna il `playerId`
     * e `skipped` resta sempre vuoto: il file serve a provare la UI, non a caricarlo.
     */
    exportRosters: () => {
      const lines: string[] = [];
      for (const p of store.state.participants) {
        lines.push('$,$,$');
        for (const r of [...p.roster].sort((a, b) => a.price - b.price)) {
          lines.push(`${p.teamName.replace(/,/g, ' ')},${r.playerId},${r.price}`);
        }
      }
      return wait<RostersExport>({
        filename: `fanta-asta-live-rosters-${Date.now()}.csv`,
        csv: lines.length ? `${lines.join('\n')}\n` : '',
        skipped: [],
      });
    },
  };

  return { socket, api };
}

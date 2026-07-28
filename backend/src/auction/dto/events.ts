/**
 * CONTRATTO REALTIME — unica fonte di verità dei payload Socket.IO.
 *
 * Questo file e `frontend/src/app/core/auction-events.ts` sono **lo stesso
 * contratto**: se cambia uno, cambiano entrambi nello stesso PR, insieme a
 * `CLAUDE.md` §5 e `frontend/README.md` (regola AGENTS.md §"Confini").
 *
 * La forma è quella "ricca" validata dalla UI: rose con i prezzi, `lot.history`
 * per il feed dei rilanci, `spent`, `online`, `lastAssigned`.
 */

export type Role = 'P' | 'D' | 'C' | 'A';

export const ROLES: readonly Role[] = ['P', 'D', 'C', 'A'] as const;

/**
 * `FILLING` = svincoli finali: nessun turno, nessun timer. Chi ha slot vuoti li
 * riempie da solo pescando fra i rimasti a `FILLING_PRICE` credito.
 * `ASSIGNED` = lotto appena chiuso: la sala guarda il risultato per
 * `ASSIGNED_HOLD_MS` prima che il turno passi.
 * `RELEASING` = finestra di svincolo del mercato di riparazione: ogni squadra
 * taglia chi vuole dalla propria rosa. Nessun turno, nessun timer, nessun lotto;
 * la chiude `admin:start`, che riapre l'asta sui buchi appena creati.
 */
export type AuctionStatus =
  'IDLE' | 'BIDDING' | 'ASSIGNED' | 'PAUSED' | 'RELEASING' | 'FILLING' | 'FINISHED';

/** Prezzo fisso di uno svincolo: non passa dall'asta, quindi non è negoziabile. */
export const FILLING_PRICE = 1;

/** Quanto resta a schermo il risultato di un lotto prima del turno successivo. */
export const ASSIGNED_HOLD_MS = 2500;

export type RosterSlots = Record<Role, number>;

/**
 * Quanti crediti tornano a chi taglia un calciatore nel mercato di riparazione.
 * È una **regola di lega**: si decide prima, non taglio per taglio.
 * - `none`      → niente, i crediti spesi restano spesi;
 * - `purchase`  → il prezzo pagato all'asta;
 * - `quotation` → la quotazione **attuale** di listone (cambia con i re-import);
 * - `average`   → media di prezzo e quotazione, arrotondata **per difetto**.
 */
export type ReleaseRefund = 'none' | 'purchase' | 'quotation' | 'average';

export interface AuctionRules {
  leagueName: string;
  auctionName: string;
  budget: number;
  rosterSlots: RosterSlots;
  callOrder: 'free' | 'fixed';
  bidTimerSeconds: number;
  startPriceMode: 'fixed' | 'quotation';
  startPrice: number;
  /** Rimborso degli svincoli di riparazione (vedi `ReleaseRefund`). */
  releaseRefund: ReleaseRefund;
}

export interface Player {
  id: number;
  name: string;
  team: string;
  role: Role;
  quotation: number;
}

/** Riga di listone con lo stato calcolato dal server. */
export interface PlayerRow extends Player {
  taken: boolean;
}

export interface RosterEntry {
  playerId: number;
  name: string;
  team: string;
  role: Role;
  price: number;
}

export interface Participant {
  id: string;
  name: string;
  teamName: string;
  avatarUrl: string | null;
  color?: string;
  /** Crediti RESIDUI. */
  budget: number;
  spent: number;
  roster: RosterEntry[];
  online: boolean;
  /** Solo per l'admin — il server NON lo invia agli altri client. */
  accessCode?: string;
  /**
   * Credenziale del magic link, **solo per l'admin** (come `accessCode`): la Regia
   * ci costruisce l'URL `<origin>/j/<magicToken>` da mandare alla squadra. L'URL lo
   * compone il client, così vale sia in locale sia in produzione senza una env in più.
   */
  magicToken?: string;
}

export type BidType = 'nominate' | 'bid';

export interface BidHistoryEntry {
  participantId: string;
  price: number;
  type: BidType;
  at: number;
}

export interface Lot {
  player: Player;
  byParticipantId: string;
  price: number;
  bestParticipantId: string;
  /** Timestamp assoluto: unica verità del countdown. */
  endsAt: number;
  history: BidHistoryEntry[];
}

export interface LastAssigned {
  playerId: number;
  playerName: string;
  participantId: string;
  teamName: string;
  price: number;
}

/**
 * Un calciatore tagliato nella finestra di svincolo del mercato di riparazione.
 * Porta **sia** il prezzo pagato **sia** il rimborso incassato: con
 * `releaseRefund` diverso da `purchase` i due numeri non coincidono, e la sala
 * vuole vedere entrambi. È anche quel che serve ad annullare un taglio in modo
 * esatto (`unrelease`).
 */
export interface ReleaseEntry {
  playerId: number;
  name: string;
  team: string;
  role: Role;
  participantId: string;
  teamName: string;
  /** Prezzo a cui era stato acquistato. */
  price: number;
  /** Crediti effettivamente restituiti, secondo `rules.releaseRefund`. */
  refund: number;
}

/**
 * Telecronaca — quel che è successo in sala, in ordine. È un giornale
 * **append-only**: un lotto riaperto non cancella la riga della vendita, ne
 * aggiunge una che la spiega.
 */
export type AuctionLogType =
  | 'start'
  | 'nominate'
  | 'bid'
  | 'assigned'
  | 'claim'
  | 'manual'
  | 'reopen'
  | 'skip'
  | 'roleClosed'
  | 'pause'
  | 'resume'
  | 'filling'
  | 'finished'
  | 'reset'
  /** Apertura di un mercato di riparazione (`detail` = ricarica di crediti). */
  | 'repairStart'
  /** Taglio in finestra di svincolo: `price` sono i crediti **rimborsati**. */
  | 'release'
  /** Taglio annullato prima della chiusura della finestra. */
  | 'unrelease';

/**
 * Riga di telecronaca. I nomi sono **denormalizzati** (non `participantId` da
 * risolvere): la cronaca deve restare leggibile anche dopo la cancellazione di
 * una squadra, e chi legge il log non ha bisogno dello stato per capirlo.
 *
 * La **frase** la compone il client (`features/log/log-line.ts`): qui stanno i
 * fatti. `price` sono i crediti in gioco — prezzo, offerta o rimborso a seconda
 * del `type`; `detail` è il dettaglio degli eventi senza protagonista.
 */
export interface AuctionLogEntry {
  /** Progressivo per lega: ordina la cronaca e fa da cursore alla paginazione. */
  seq: number;
  type: AuctionLogType;
  /** Timestamp assoluto (epoch ms). */
  at: number;
  participantId: string | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  role: Role | null;
  price: number | null;
  detail: string | null;
}

/**
 * Quante righe di telecronaca viaggiano dentro `AuctionState.log`: la coda
 * recente, non la storia. La storia intera si chiede a `GET /log` — mandarla in
 * ogni snapshot costerebbe banda a ogni rilancio (INFRA.md, budget a costo zero).
 */
export const LOG_TAIL = 25;

export interface AuctionState {
  status: AuctionStatus;
  rules: AuctionRules;
  participants: Participant[];
  turnOrder: string[];
  currentTurnParticipantId: string;
  /**
   * Reparto in corso — solo con `callOrder: 'fixed'`. È il primo ruolo P→D→C→A
   * **non chiuso** in cui almeno un partecipante ha uno slot libero. Derivato a
   * ogni emissione, mai persistito.
   */
  currentRole: Role | null;
  /**
   * Reparti che l'admin ha chiuso in anticipo, con slot ancora vuoti: non tornano
   * all'asta, quegli slot si riempiono negli svincoli (`status: 'FILLING'`).
   */
  closedRoles: Role[];
  lot: Lot | null;
  lastAssigned: LastAssigned | null;
  /**
   * `0` = asta iniziale. Incrementa a ogni `admin:startRepair`: `1` è il primo
   * mercato di riparazione. Serve alla UI per dire "Riparazione #1" e al server
   * per sapere a quale round appartengono gli svincoli.
   */
  repairRound: number;
  /**
   * Svincoli del round di riparazione **in corso**, il più recente in testa.
   * Vuoto fuori dalla riparazione. Sono i calciatori che stanno per tornare
   * all'asta: la sala li vede accumularsi mentre la finestra è aperta.
   */
  releases: ReleaseEntry[];
  /**
   * Coda della telecronaca — le ultime `LOG_TAIL` righe, **la più recente in
   * testa**. È la cronaca recente per il feed in sala; la storia completa è in
   * `GET /log`.
   */
  log: AuctionLogEntry[];
}

/* ---------- Client → Server ---------- */

export interface AuthPayload {
  /**
   * Una fra: JWT di sessione (quel che il client ha salvato), magic token del
   * link `/j/<token>`, codice d'accesso a 6 caratteri, `ADMIN_TOKEN`. Il server
   * capisce da solo quale sia.
   */
  token: string;
  /** Se presente, il server verifica che la credenziale sia di quella squadra. */
  participantId?: string;
}
export interface NominatePayload {
  playerId: number;
  startPrice?: number;
}
export interface BidPayload {
  mode: 'plus1' | 'amount';
  value?: number;
}
/** Svincolo: prendo un rimasto a `FILLING_PRICE`, senza asta. Solo in `FILLING`. */
export interface ClaimPayload {
  playerId: number;
}
export interface AssignManualPayload {
  playerId: number;
  participantId: string;
  price: number;
}
/**
 * Riapre un lotto già chiuso: rimborsa il compratore e lo rimette all'asta al
 * prezzo base. Solo admin, solo a lotto chiuso.
 */
export interface ReopenLotPayload {
  playerId: number;
}
/**
 * Taglia un calciatore dalla **propria** rosa. Solo in `RELEASING`; il rimborso
 * lo decide la regola di lega, non il payload. `unrelease` è l'annullamento e ha
 * la stessa forma: vale finché la finestra è aperta.
 */
export interface ReleasePayload {
  playerId: number;
}
/**
 * Apre un mercato di riparazione: incrementa `repairRound`, riapre i reparti
 * chiusi e mette la sala in `RELEASING`. `extraBudget` è una ricarica di crediti
 * uguale per tutti (0 = si ripara col solo residuo). Solo admin, solo a lotto chiuso.
 */
export interface StartRepairPayload {
  extraBudget?: number;
}

/* ---------- Server → Client ---------- */

/**
 * Sessione persistibile emessa dopo un `auth` riuscito: un JWT firmato dal
 * server. È **l'unica** credenziale che il client salva sul dispositivo — mai il
 * magic token, mai il codice a 6 caratteri (PLAN.md, decisione 21).
 */
export interface SessionToken {
  token: string;
  /** Scadenza assoluta (epoch ms): il client ci decide quando smettere di riprovare. */
  expiresAt: number;
}

/**
 * Ack di `auth`: il client sa chi è senza inferirlo (PLAN.md, decisione 6 —
 * scelto l'ack, **non** un evento `session`).
 */
export interface AuthAck {
  ok: boolean;
  isAdmin?: boolean;
  participantId?: string | null;
  /**
   * Presente quando il server emette o **rinnova** la sessione da salvare. Assente
   * se quella già in mano al client vale ancora, e per l'admin (che entra col token
   * condiviso, non con una sessione).
   */
  session?: SessionToken;
  code?: string;
  message?: string;
}
export interface TurnPayload {
  participantId: string;
}
export interface NominatedPayload {
  player: Player;
  byParticipantId: string;
  price: number;
  endsAt: number;
}
export interface BidBroadcast {
  participantId: string;
  price: number;
  endsAt: number;
}
export interface TickPayload {
  remainingMs: number;
}
/** Il lotto chiuso: stesso contenuto di `AuctionState.lastAssigned`. */
export type AssignedPayload = LastAssigned;
/** Uno svincolo di riparazione, appena fatto o appena annullato. */
export interface ReleasedPayload extends ReleaseEntry {
  /** `true` se è l'annullamento di un taglio (`unrelease`). */
  undone: boolean;
}
export interface BudgetUpdatedPayload {
  participantId: string;
  budget: number;
  slots: RosterSlots;
  maxBid: number;
}
export interface ErrorMsgPayload {
  code: ErrorCode | string;
  message: string;
}

/**
 * Codici di rifiuto emessi dal server. Il client li mostra: **non** li anticipa —
 * `maxBid` lato client serve solo ad abilitare i bottoni.
 */
export type ErrorCode =
  | 'AUTH_FAILED'
  | 'AUTH_MISMATCH'
  /** Sessione salvata scaduta o revocata: si butta e si rientra dal link. */
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NO_IDENTITY'
  | 'UNKNOWN_PARTICIPANT'
  | 'UNKNOWN_PLAYER'
  | 'UNKNOWN_EVENT'
  | 'PAUSED'
  | 'LOT_OPEN'
  | 'NOT_IDLE'
  | 'NOT_YOUR_TURN'
  | 'NOT_BIDDING'
  | 'NOT_FILLING'
  | 'NOT_FIXED_ORDER'
  /** La finestra di svincolo non è aperta. */
  | 'NOT_RELEASING'
  /** Si può tagliare solo dalla propria rosa. */
  | 'NOT_IN_ROSTER'
  /** Non c'è nessun taglio da annullare per questo calciatore. */
  | 'NOT_RELEASED'
  | 'ALREADY_COMPLETE'
  | 'PLAYER_TAKEN'
  | 'NOT_ASSIGNED'
  | 'ROLE_FULL'
  | 'ROLE_LOCKED'
  | 'ALREADY_BEST'
  | 'BID_TOO_LOW'
  | 'BID_INVALID'
  | 'INSUFFICIENT_CREDITS'
  | 'NO_AUCTION';

/** Nomi degli eventi — evita magic strings. Allineato a CLAUDE.md §5. */
export const EV = {
  // client → server
  AUTH: 'auth',
  NOMINATE: 'nominate',
  BID: 'bid',
  CLAIM: 'claim',
  RELEASE: 'release',
  UNRELEASE: 'unrelease',
  ADMIN_START: 'admin:start',
  ADMIN_START_REPAIR: 'admin:startRepair',
  ADMIN_PAUSE: 'admin:pause',
  ADMIN_RESUME: 'admin:resume',
  ADMIN_SKIP: 'admin:skipTurn',
  ADMIN_ASSIGN: 'admin:assignManual',
  ADMIN_ADVANCE_ROLE: 'admin:advanceRole',
  ADMIN_REOPEN_LOT: 'admin:reopenLot',
  // server → client
  STATE: 'state',
  TURN: 'turn',
  NOMINATED: 'nominated',
  BID_BROADCAST: 'bid',
  TICK: 'tick',
  ASSIGNED: 'assigned',
  RELEASED: 'released',
  BUDGET_UPDATED: 'budgetUpdated',
  ERROR: 'errorMsg',
  FINISHED: 'finished',
} as const;

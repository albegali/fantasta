import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import {
  AssignedPayload,
  AuctionState,
  AuthAck,
  EV,
  ErrorMsgPayload,
  Participant,
  ReleaseEntry,
  Role,
  ROLES,
  RosterEntry,
  RosterSlots,
} from './auction-events';
import { ApiPort, SocketPort } from './ports';
import { SessionStore } from './session.store';

const QUIPS = [
  'Pagato tanto. Come sempre.',
  'Affare. O almeno lo racconterà così.',
  'La sala rumoreggia.',
  'Nessuno ha rilanciato: sospetto.',
  'Il fantallenatore esulta da solo.',
];

/** Ogni quanto ravviviamo il countdown della UI (solo smoothing dell'anello). */
const UI_TICK_MS = 100;
/** Quanto resta a schermo un `errorMsg`. */
const ERROR_TTL_MS = 2600;
/**
 * Quanto si aspetta il server sulla ripresa della sessione salvata. Senza, un
 * backend spento a freddo (spin-down del tier gratuito, vedi INFRA.md) lascerebbe
 * l'app appesa: scaduto il tempo si mostra l'accesso, e la sessione resta salvata
 * per il tentativo successivo.
 */
const RESUME_TIMEOUT_MS = 4000;

/**
 * Stato client dell'asta: **una** sorgente di verità, alimentata dagli eventi
 * socket. Nessuna regola d'asta qui — `maxBid` e i flag di abilitazione sono
 * solo per accendere/spegnere i bottoni; il rifiuto vero arriva come `errorMsg`
 * (vedi `frontend-handoff.md` §3 e AGENTS.md §1).
 */
@Injectable({ providedIn: 'root' })
export class AuctionStore {
  private readonly socket = inject(SocketPort);
  private readonly api = inject(ApiPort);
  private readonly session = inject(SessionStore);

  private readonly _state = signal<AuctionState | null>(null);
  private readonly _error = signal('');
  private readonly _quip = signal(QUIPS[0]);
  /** Clock locale per il countdown; la verità resta `lot.endsAt`. */
  private readonly _now = signal(Date.now());

  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private uiTimer: ReturnType<typeof setInterval> | null = null;
  /** Memoizza `init()`: chi arriva dopo aspetta lo stesso avvio, non ne fa un altro. */
  private booting: Promise<void> | null = null;

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly quip = this._quip.asReadonly();

  readonly ready = computed(() => this._state() !== null);
  readonly rules = computed(() => this._state()?.rules ?? null);
  readonly participants = computed<Participant[]>(() => this._state()?.participants ?? []);
  readonly lot = computed(() => this._state()?.lot ?? null);
  readonly status = computed(() => this._state()?.status ?? 'IDLE');

  readonly me = computed<Participant | null>(() => this.byId(this.session.participantId()));

  readonly isMyTurn = computed(() => {
    const me = this.me();
    return !!me && this._state()?.currentTurnParticipantId === me.id;
  });

  readonly turnParticipant = computed<Participant | null>(
    () =>
      this.byId(this._state()?.currentTurnParticipantId ?? null) ?? this.participants()[0] ?? null,
  );

  /** Countdown derivato da `endsAt`, mai dal `tick`. */
  readonly remainingMs = computed(() => {
    const lot = this.lot();
    return lot ? Math.max(0, lot.endsAt - this._now()) : 0;
  });
  readonly remainingSeconds = computed(() => this.remainingMs() / 1000);

  /** Massimo offribile da me restando in regola. Indicativo: decide il server. */
  readonly myMaxBid = computed(() => {
    const me = this.me();
    return me ? this.maxBidOf(me) : 0;
  });

  readonly amIBest = computed(() => {
    const lot = this.lot();
    const me = this.me();
    return !!lot && !!me && lot.bestParticipantId === me.id;
  });

  /** Si compra un reparto alla volta per tutta la lega. */
  readonly isFixedOrder = computed(() => this.rules()?.callOrder === 'fixed');

  /** Reparto in corso — valorizzato dal server solo con `callOrder: 'fixed'`. */
  readonly currentRole = computed<Role | null>(() => this._state()?.currentRole ?? null);

  /** Reparti chiusi in anticipo dall'admin: i loro slot vanno agli svincoli. */
  readonly closedRoles = computed<Role[]>(() => this._state()?.closedRoles ?? []);

  /** Svincoli finali aperti: si completa la rosa a prezzo fisso, senza asta. */
  readonly isFilling = computed(() => this.status() === 'FILLING');

  // ── mercato di riparazione ──

  /** Finestra di svincolo aperta: ognuno taglia dalla propria rosa. */
  readonly isReleasing = computed(() => this.status() === 'RELEASING');

  /** `0` fuori dalla riparazione; `1` è il primo mercato. */
  readonly repairRound = computed(() => this._state()?.repairRound ?? 0);

  /** Tutti i tagli del round in corso, il più recente in testa. */
  readonly releases = computed<ReleaseEntry[]>(() => this._state()?.releases ?? []);

  /** I miei tagli: quelli che posso ancora annullare. */
  readonly myReleases = computed<ReleaseEntry[]>(() => {
    const me = this.session.participantId();
    return me ? this.releases().filter((r) => r.participantId === me) : [];
  });

  /**
   * Quanto mi renderebbe tagliare questo giocatore, secondo `rules.releaseRefund`.
   * Serve **solo** a scrivere la cifra sul bottone: il rimborso vero lo calcola
   * il server, che è l'unico a conoscere la quotazione aggiornata.
   *
   * La quotazione non è nella rosa (`RosterEntry` non la porta), quindi in modo
   * `quotation`/`average` questa stima non è calcolabile lato client e torna
   * `null`: il pannello scrive "secondo quotazione" invece di un numero inventato.
   */
  refundPreview(entry: RosterEntry): number | null {
    switch (this.rules()?.releaseRefund) {
      case 'none':
        return 0;
      case 'purchase':
        return entry.price;
      default:
        return null; // quotation / average: la sa solo il server
    }
  }

  /** Ho ancora slot da riempire (usato dagli svincoli). */
  readonly mySlotsLeft = computed(() => {
    const me = this.me();
    return me ? this.slotsLeft(me) : 0;
  });

  /**
   * Ho saturato il reparto in corso: il server salta i miei turni finché la lega
   * non passa al reparto successivo. Serve solo a spiegarlo a schermo.
   */
  readonly amISkipped = computed(() => {
    const me = this.me();
    const role = this.currentRole();
    return !!me && !!role && !this.needsRole(me, role) && this.slotsLeft(me) > 0;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /**
   * Aggancia i listener, apre la socket, riprende la sessione salvata e carica lo
   * stato iniziale. Idempotente: le guard di rotta la usano come punto d'attesa
   * (`joined.guard.ts`), quindi va bene chiamarla da più parti.
   */
  init(): Promise<void> {
    if (!this.booting) this.booting = this.boot();
    return this.booting;
  }

  private async boot(): Promise<void> {
    this.socket.on<AuctionState>(EV.STATE, (snap) => this._state.set(snap));
    this.socket.on<AssignedPayload>(EV.ASSIGNED, () =>
      this._quip.set(QUIPS[Math.floor(Math.random() * QUIPS.length)]),
    );
    this.socket.on<ErrorMsgPayload>(EV.ERROR, (e) => this.flashError(e.message));
    this.socket.on<unknown>(EV.TICK, () => this._now.set(Date.now()));
    // Socket nuova dopo un drop: la sessione del server viveva su quella vecchia,
    // quindi ci si ripresenta da soli invece di restare in sala da spettatori.
    this.socket.on<unknown>('connect', () => {
      if (this.session.joined()) void this.auth(this.session.token());
    });

    this.socket.connect();

    // Le altre notifiche (`turn`, `nominated`, `bid`, `budgetUpdated`, `finished`)
    // arrivano sempre accompagnate da uno `state`: non serve gestirle per lo stato.

    this.uiTimer = setInterval(() => {
      if (this._state()?.lot) this._now.set(Date.now());
    }, UI_TICK_MS);

    const resumed = this.resumeSaved();
    try {
      this._state.set(await this.api.getState());
    } catch {
      this.flashError('Sala non raggiungibile. Riprovo alla prossima notifica.');
    }
    await resumed;
  }

  /**
   * Rientro silenzioso con la sessione salvata: nessuna schermata d'accesso per
   * chi era già in sala. Se il server la rifiuta (`SESSION_EXPIRED`: scaduta, o
   * credenziali rigenerate dall'admin) la si butta e si riparte dall'accesso.
   */
  private async resumeSaved(): Promise<void> {
    const saved = this.session.restore();
    if (!saved) return;
    const ack = await withTimeout(this.auth(saved.token), RESUME_TIMEOUT_MS);
    if (ack && !ack.ok) this.session.forget();
  }

  // ── intenzioni (client → server) ──

  /** `auth` con ack: è l'unica estensione al contratto (frontend-handoff.md §4). */
  auth(token: string, participantId?: string): Promise<AuthAck> {
    return new Promise((resolve) => {
      this.socket.emit<AuthAck>(EV.AUTH, { token, participantId }, (ack) => {
        if (ack?.ok) {
          this.session.open(token, ack.participantId ?? null, !!ack.isAdmin, ack.session);
        }
        resolve(ack);
      });
    });
  }

  leave(): void {
    this.session.close();
  }

  nominate(playerId: number, startPrice?: number): void {
    this.socket.emit(EV.NOMINATE, { playerId, startPrice });
  }
  bidPlus1(): void {
    this.socket.emit(EV.BID, { mode: 'plus1' });
  }
  bidAmount(value: number): void {
    this.socket.emit(EV.BID, { mode: 'amount', value });
  }

  /** Svincolo: prendo un rimasto a prezzo fisso. Solo con `status: 'FILLING'`. */
  claim(playerId: number): void {
    this.socket.emit(EV.CLAIM, { playerId });
  }

  /** Taglio dalla mia rosa. Solo con `status: 'RELEASING'`; il rimborso è di lega. */
  release(playerId: number): void {
    this.socket.emit(EV.RELEASE, { playerId });
  }

  /** Ripensamento: annulla un mio taglio, finché la finestra è aperta. */
  unrelease(playerId: number): void {
    this.socket.emit(EV.UNRELEASE, { playerId });
  }

  adminStart(): void {
    this.socket.emit(EV.ADMIN_START, {});
  }
  /**
   * Apre un mercato di riparazione: finestra di svincolo + ricarica opzionale.
   * La finestra la chiude poi `adminStart()`.
   */
  adminStartRepair(extraBudget = 0): void {
    this.socket.emit(EV.ADMIN_START_REPAIR, { extraBudget });
  }
  adminPause(): void {
    this.socket.emit(EV.ADMIN_PAUSE, {});
  }
  adminResume(): void {
    this.socket.emit(EV.ADMIN_RESUME, {});
  }
  adminSkipTurn(): void {
    this.socket.emit(EV.ADMIN_SKIP, {});
  }
  /** Chiude il reparto in corso anche se incompleto; se non ne restano, apre gli svincoli. */
  adminAdvanceRole(): void {
    this.socket.emit(EV.ADMIN_ADVANCE_ROLE, {});
  }
  adminAssignManual(playerId: number, participantId: string, price: number): void {
    this.socket.emit(EV.ADMIN_ASSIGN, { playerId, participantId, price });
  }
  /**
   * Riapre un lotto chiuso: il server rimborsa il compratore e lo rimette
   * all'asta al prezzo base. Da usare a lotto chiuso (in pausa va benissimo).
   */
  adminReopenLot(playerId: number): void {
    this.socket.emit(EV.ADMIN_REOPEN_LOT, { playerId });
  }

  // ── helper di sola lettura per la UI ──

  byId(id: string | null): Participant | null {
    if (!id) return null;
    return this.participants().find((p) => p.id === id) ?? null;
  }

  slotsUsed(participant: Participant): RosterSlots {
    const counts: RosterSlots = { P: 0, D: 0, C: 0, A: 0 };
    for (const entry of participant.roster) counts[entry.role] += 1;
    return counts;
  }

  slotsLeft(participant: Participant): number {
    const rules = this.rules();
    if (!rules) return 0;
    const used = this.slotsUsed(participant);
    return ROLES.reduce((n, role) => n + Math.max(0, rules.rosterSlots[role] - used[role]), 0);
  }

  maxBidOf(participant: Participant): number {
    return Math.max(0, participant.budget - Math.max(0, this.slotsLeft(participant) - 1));
  }

  needsRole(participant: Participant, role: Role): boolean {
    const rules = this.rules();
    return !!rules && this.slotsUsed(participant)[role] < rules.rosterSlots[role];
  }

  flashError(message: string): void {
    this._error.set(message);
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => this._error.set(''), ERROR_TTL_MS);
  }

  private teardown(): void {
    if (this.uiTimer) clearInterval(this.uiTimer);
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.socket.disconnect();
  }
}

/** `null` se il server non risponde in tempo: l'attesa non deve essere infinita. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

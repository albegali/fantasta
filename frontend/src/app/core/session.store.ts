import { Injectable, computed, signal } from '@angular/core';

import { SessionToken } from './auction-events';

/** Dove vive la sessione fra un ricaricamento e l'altro. */
const STORAGE_KEY = 'fantasta.session';

/**
 * Chi sono io in questa sala. Popolato dall'ack di `auth` (vedi
 * `frontend-handoff.md` §4): il client **non inferisce** participantId/isAdmin.
 *
 * Cosa si salva sul dispositivo e cosa no (PLAN.md, decisione 21):
 *
 * - **sì** il JWT di sessione emesso dal server — scade da solo, si revoca
 *   rigenerando le credenziali della squadra, e senza di lui ogni schermo bloccato
 *   a metà asta costringerebbe a ripescare il link su WhatsApp;
 * - **no** il magic token del link e il codice a 6 caratteri: sono credenziali
 *   durevoli, restano dove l'admin le ha mandate;
 * - **no** il token d'admin: entra a mano, come prima.
 *
 * `token` è la credenziale da rigiocare su una riconnessione: per un partecipante
 * diventa il JWT appena il server lo emette, per l'admin resta l'`ADMIN_TOKEN`
 * (che `rest-api.adapter.ts` usa anche come header `x-admin-token`).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly token = signal('');
  readonly participantId = signal<string | null>(null);
  readonly isAdmin = signal(false);
  readonly joined = signal(false);

  readonly canAdmin = computed(() => this.joined() && this.isAdmin());

  open(
    token: string,
    participantId: string | null,
    isAdmin: boolean,
    session?: SessionToken,
  ): void {
    // Emessa o rinnovata: da qui in poi la credenziale da rigiocare è il JWT.
    if (session) this.save(session);
    this.token.set(session?.token ?? token);
    this.participantId.set(participantId);
    this.isAdmin.set(isAdmin);
    this.joined.set(true);
  }

  close(): void {
    this.forget();
    this.token.set('');
    this.participantId.set(null);
    this.isAdmin.set(false);
    this.joined.set(false);
  }

  /**
   * La sessione salvata, se c'è e non è già scaduta. Non apre la sala da sola: a
   * dire chi sono è sempre l'ack del server, questa è solo la credenziale da
   * provare (`AuctionStore.init`).
   */
  restore(): SessionToken | null {
    const saved = read();
    if (!saved) return null;
    if (saved.expiresAt <= Date.now()) {
      this.forget();
      return null;
    }
    this.token.set(saved.token);
    return saved;
  }

  /** Butta la sessione salvata: scaduta, revocata, o uscita volontaria. */
  forget(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage negato (Safari privato): la sessione resta solo in memoria */
    }
  }

  private save(session: SessionToken): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* idem: si continua senza persistenza, non è un errore da mostrare */
    }
  }
}

function read(): SessionToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSessionToken(parsed)) return null;
    return parsed;
  } catch {
    return null; // storage negato o JSON storto: si riparte dall'accesso
  }
}

function isSessionToken(value: unknown): value is SessionToken {
  const v = value as Partial<SessionToken> | null;
  return !!v && typeof v.token === 'string' && typeof v.expiresAt === 'number';
}

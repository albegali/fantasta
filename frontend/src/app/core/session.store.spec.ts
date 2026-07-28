/**
 * Cosa sopravvive a un ricaricamento e cosa no. È la regola di riservatezza del
 * magic link (PLAN.md, decisione 21): sul dispositivo resta **solo** il JWT di
 * sessione, mai la credenziale durevole che l'admin ha mandato in chat.
 */

import { SessionToken } from './auction-events';
import { SessionStore } from './session.store';

const STORAGE_KEY = 'fantasta.session';
const HOUR_MS = 60 * 60 * 1000;

const session = (patch: Partial<SessionToken> = {}): SessionToken => ({
  token: 'jwt.di.prova',
  expiresAt: Date.now() + 24 * HOUR_MS,
  ...patch,
});

describe('SessionStore', () => {
  beforeEach(() => localStorage.clear());

  it('salva la sessione emessa dal server, non la credenziale usata per entrare', () => {
    const store = new SessionStore();
    store.open('MAGIC-TOKEN-DEL-LINK', 'p1', false, session());

    expect(localStorage.getItem(STORAGE_KEY)).toContain('jwt.di.prova');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('MAGIC-TOKEN-DEL-LINK');
    // Da qui in poi si rigioca il JWT, non il magic token.
    expect(store.token()).toBe('jwt.di.prova');
  });

  it('l’admin entra col token condiviso e non lascia niente sul dispositivo', () => {
    const store = new SessionStore();
    store.open('ADMIN-2026', null, true);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(store.token()).toBe('ADMIN-2026'); // serve come header `x-admin-token`
    expect(store.canAdmin()).toBe(true);
  });

  it('riprende una sessione salvata senza dichiararsi in sala: decide il server', () => {
    new SessionStore().open('7KQ2MX', 'p1', false, session());

    const reloaded = new SessionStore();
    expect(reloaded.restore()?.token).toBe('jwt.di.prova');
    expect(reloaded.token()).toBe('jwt.di.prova');
    expect(reloaded.joined()).toBe(false);
  });

  it('una sessione già scaduta non si riprende e sparisce', () => {
    new SessionStore().open('7KQ2MX', 'p1', false, session({ expiresAt: Date.now() - HOUR_MS }));

    const reloaded = new SessionStore();
    expect(reloaded.restore()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('roba illeggibile nello storage non fa saltare l’accesso', () => {
    localStorage.setItem(STORAGE_KEY, '{non-json');
    expect(new SessionStore().restore()).toBeNull();
  });

  it('uscire dalla sala cancella la sessione salvata', () => {
    const store = new SessionStore();
    store.open('7KQ2MX', 'p1', false, session());
    store.close();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(store.joined()).toBe(false);
    expect(store.participantId()).toBeNull();
  });
});

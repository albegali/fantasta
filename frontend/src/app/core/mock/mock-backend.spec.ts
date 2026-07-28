/**
 * Smoke test del mock: auth → nominate → bid → chiusura del lotto.
 * Verifica che il trasporto finto emetta gli eventi del contratto (CLAUDE.md §5)
 * nell'ordine giusto — è ciò che tiene in piedi lo sviluppo offline.
 */

import { AssignedPayload, AuctionState, LOG_TAIL, ROLES } from '../auction-events';
import { createMockBackend } from './mock-backend';

const { socket, api } = createMockBackend({ simulateOpponents: false, tickMs: 20 });

const waitFor = <T>(event: string, predicate: (payload: T) => boolean, ms = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout in attesa di "${event}"`));
    }, ms);
    const handler = (payload: T): void => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on<T>(event, handler);
  });

const emit = <A>(event: string, payload: unknown): Promise<A> =>
  new Promise((resolve) => socket.emit<A>(event, payload, resolve));

describe('mock-backend', () => {
  it('lista i calciatori per quotazione decrescente, filtrabili per reparto', async () => {
    const top = await api.listPlayers({ take: 5 });
    expect(top).toHaveLength(5);
    // `take` deve dare i più quotati, non i primi del listone.
    expect(top[0].name).toBe('Lautaro Martinez');
    expect(top.map((p) => p.quotation)).toEqual(
      [...top.map((p) => p.quotation)].sort((a, b) => b - a),
    );

    const keepers = await api.listPlayers({ role: 'P', take: 20 });
    expect(keepers.every((p) => p.role === 'P')).toBe(true);
    expect(keepers[0].name).toBe('Maignan');

    const byTeam = await api.listPlayers({ q: 'inter' });
    expect(byTeam.every((p) => p.team === 'Inter')).toBe(true);
  });

  it('porta un lotto dalla chiamata all’assegnazione', async () => {
    // Timer corto: il test non deve aspettare i 5 secondi di default.
    await api.putRules({ bidTimerSeconds: 1 });

    const ack = await emit<{ ok: boolean; participantId?: string | null }>('auth', {
      token: '7KQ2MX',
      participantId: 'p1',
    });
    expect(ack.ok).toBe(true);
    expect(ack.participantId).toBe('p1');

    const [players, snap] = await Promise.all([api.listPlayers({ q: 'Maignan' }), api.getState()]);
    const target = players[0];
    expect(target.name).toBe('Maignan');
    expect(snap.currentTurnParticipantId).toBe('p1');

    const bidding = waitFor<AuctionState>('state', (s) => s.status === 'BIDDING');
    socket.emit('nominate', { playerId: target.id });
    const open = await bidding;
    expect(open.lot?.player.id).toBe(target.id);
    expect(open.lot?.price).toBe(1);
    expect(open.lot?.history).toHaveLength(1);

    // Chi ha chiamato è già il miglior offerente: il server rifiuta il suo rilancio.
    const rejection = waitFor<{ code: string }>('errorMsg', () => true);
    socket.emit('bid', { mode: 'plus1' });
    expect((await rejection).code).toBe('ALREADY_BEST');

    // L'admin chiude il lotto a mano su un'altra squadra.
    const assigned = waitFor<AssignedPayload>('assigned', () => true);
    socket.emit('admin:assignManual', { playerId: target.id, participantId: 'p2', price: 7 });
    const result = await assigned;
    expect(result.participantId).toBe('p2');
    expect(result.price).toBe(7);

    const after = await api.getState();
    const winner = after.participants.find((p) => p.id === 'p2')!;
    expect(winner.roster.map((r) => r.playerId)).toContain(target.id);
    expect(winner.spent).toBe(7);
    expect(winner.budget).toBe(after.rules.budget - 7);

    // La riga di listone risulta ora assegnata.
    const [reloaded] = await api.listPlayers({ q: 'Maignan' });
    expect(reloaded.taken).toBe(true);
  });

  /**
   * Il salto dei turni per reparto (`callOrder: 'fixed'`). Deterministico:
   * `simulateOpponents: false` e assegnazioni pilotate dall'admin, così non
   * dipende da chi rilancia.
   */
  it('con callOrder fixed salta chi ha saturato il reparto, e lo riammette al cambio', async () => {
    // Riduco la lega a due squadre e a un solo portiere: il reparto si chiude in fretta.
    for (const id of ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']) await api.deleteParticipant(id);
    await api.putRules({
      callOrder: 'fixed',
      rosterSlots: { P: 1, D: 8, C: 8, A: 6 },
      bidTimerSeconds: 1,
    });
    await api.resetAuction();

    const keepers = await api.listPlayers({ role: 'P', available: true, take: 2 });
    expect(keepers).toHaveLength(2);

    const start = await api.getState();
    expect(start.participants.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(start.currentRole).toBe('P');
    expect(start.currentTurnParticipantId).toBe('p1');

    // p1 prende il suo unico portiere → il reparto resta "P" (p2 ne ha ancora
    // bisogno), quindi p1 va saltato e il turno passa a p2.
    // Attendo lo snapshot *dopo* l'avanzamento del turno: quello dell'assegnazione
    // (status ASSIGNED) arriva prima e porta ancora il turno vecchio.
    const afterFirst = waitFor<AuctionState>('state', (s) => s.status === 'IDLE');
    socket.emit('admin:assignManual', { playerId: keepers[0].id, participantId: 'p1', price: 5 });
    const mid = await afterFirst;
    expect(mid.currentRole).toBe('P');
    expect(mid.currentTurnParticipantId).toBe('p2');

    // Anche p2 prende il portiere → il reparto passa a "D" e p1 rientra in turno.
    const afterSecond = waitFor<AuctionState>(
      'state',
      (s) => s.status === 'IDLE' && s.currentRole === 'D',
    );
    socket.emit('admin:assignManual', { playerId: keepers[1].id, participantId: 'p2', price: 5 });
    const end = await afterSecond;
    expect(end.currentRole).toBe('D');
    expect(end.currentTurnParticipantId).toBe('p1');
  }, 20000);

  /**
   * L'admin forza l'avanzamento lasciando slot vuoti, e alla fine gli svincoli li
   * chiudono a 1 credito. È il caso descritto dal maintainer: pochi slot che
   * nessuno si contenderebbe.
   */
  it('l’admin chiude i reparti in anticipo e gli svincoli completano le rose', async () => {
    // Una sola squadra, un solo slot per reparto: il giro si chiude in fretta.
    for (const id of ['p2']) await api.deleteParticipant(id);
    await api.putRules({
      callOrder: 'fixed',
      rosterSlots: { P: 1, D: 1, C: 1, A: 1 },
      bidTimerSeconds: 1,
    });
    await api.resetAuction();

    const start = await api.getState();
    expect(start.participants.map((p) => p.id)).toEqual(['p1']);
    expect(start.currentRole).toBe('P');
    expect(start.closedRoles).toEqual([]);

    // L'admin chiude tutti e quattro i reparti senza che si compri niente.
    for (const role of ROLES) {
      const closed = waitFor<AuctionState>('state', (s) => s.closedRoles.includes(role));
      socket.emit('admin:advanceRole', {});
      await closed;
    }

    const filling = await api.getState();
    expect(filling.closedRoles).toEqual(['P', 'D', 'C', 'A']);
    expect(filling.currentRole).toBeNull();
    // Nessun reparto da battere + rose incomplete → svincoli aperti.
    expect(filling.status).toBe('FILLING');

    // Fuori dagli svincoli il claim sarebbe rifiutato; qui passa a 1 credito.
    const keeper = (await api.listPlayers({ role: 'P', available: true, take: 1 }))[0];
    const claimed = waitFor<AssignedPayload>('assigned', () => true);
    socket.emit('claim', { playerId: keeper.id });
    const result = await claimed;
    expect(result.participantId).toBe('p1');
    expect(result.price).toBe(1);

    const afterClaim = await api.getState();
    const me = afterClaim.participants[0];
    expect(me.roster.map((r) => r.playerId)).toContain(keeper.id);
    expect(me.spent).toBe(1);
    expect(afterClaim.status).toBe('FILLING'); // restano D, C, A da chiudere

    // Completo la rosa: al quarto svincolo l'asta finisce da sé.
    for (const role of ['D', 'C', 'A'] as const) {
      const [pick] = await api.listPlayers({ role, available: true, take: 1 });
      const done = waitFor<AssignedPayload>('assigned', (a) => a.playerId === pick.id);
      socket.emit('claim', { playerId: pick.id });
      await done;
    }

    const end = await api.getState();
    expect(end.status).toBe('FINISHED');
    expect(end.participants[0].roster).toHaveLength(4);
    // Quattro svincoli a 1 credito: budget quasi intatto.
    expect(end.participants[0].spent).toBe(4);
  }, 25000);

  /**
   * Riapertura di un lotto dalla Regia: rimborso e si ribatte. Riparte dall'asta
   * finita del test precedente — riaprire un lotto "sblocca" l'asta e, chiuso il
   * lotto ribattuto, la fase si ricalcola da sé.
   */
  it('l’admin riapre un lotto: rimborso, prezzo base, e la fase si ricalcola', async () => {
    const before = await api.getState();
    expect(before.status).toBe('FINISHED');
    const entry = before.participants[0].roster[0]; // preso a 1 credito negli svincoli
    const spentBefore = before.participants[0].spent;

    // Un calciatore libero non è un lotto: non si riapre.
    const rejected = waitFor<{ code: string }>('errorMsg', () => true);
    const [free] = await api.listPlayers({ available: true, take: 1 });
    socket.emit('admin:reopenLot', { playerId: free.id });
    expect((await rejected).code).toBe('NOT_ASSIGNED');

    // La ricerca della Regia vede solo i venduti.
    const sold = await api.listPlayers({ taken: true, take: 50 });
    expect(sold).toHaveLength(4);
    expect(sold.every((p) => p.taken)).toBe(true);

    const reopening = waitFor<AuctionState>('state', (s) => s.status === 'BIDDING');
    socket.emit('admin:reopenLot', { playerId: entry.playerId });
    const open = await reopening;
    expect(open.lot?.player.id).toBe(entry.playerId);
    expect(open.lot?.price).toBe(1); // prezzo base di lega, non quello di vendita
    // Era uno svincolo: nessun chiamante originale, quindi lo tiene il compratore.
    expect(open.lot?.bestParticipantId).toBe('p1');
    expect(open.lot?.history).toHaveLength(1);
    expect(open.participants[0].roster).toHaveLength(3);
    expect(open.participants[0].spent).toBe(spentBefore - entry.price);

    // Nessuno rilancia: torna a chi lo teneva e l'asta si richiude da sé.
    const back = await waitFor<AuctionState>('state', (s) => s.status === 'FINISHED', 8000);
    expect(back.participants[0].roster).toHaveLength(4);
    expect(back.participants[0].spent).toBe(spentBefore);
  }, 20000);

  /**
   * Telecronaca: la cronaca di tutto quel che i test precedenti hanno fatto fare
   * alla sala. Parte dall'ultimo `resetAuction`, che azzera il log come sul server.
   */
  it('tiene la telecronaca di quel che è successo in sala', async () => {
    const log = await api.getLog();
    expect(log.length).toBeGreaterThan(8);

    // Numerazione decrescente e senza buchi: è il cursore della paginazione.
    expect(log.map((e) => e.seq)).toEqual([...log.map((e) => e.seq)].sort((a, b) => b - a));
    expect(log.at(-1)!.type).toBe('reset'); // il reset apre la cronaca nuova

    const types = new Set(log.map((e) => e.type));
    for (const expected of ['roleClosed', 'filling', 'claim', 'reopen', 'assigned', 'finished']) {
      expect(types).toContain(expected);
    }

    // Chi ha comprato cosa e a quanto: nomi già dentro la riga, niente da risolvere.
    const purchases = await api.getLog({ types: ['assigned', 'claim', 'manual'] });
    expect(purchases.length).toBeGreaterThan(0);
    expect(purchases.every((e) => e.playerName && e.teamName && e.price !== null)).toBe(true);
    expect(purchases.every((e) => e.participantId === 'p1')).toBe(true);

    // Il reparto chiuso non ha protagonista: porta il reparto e il dettaglio.
    const closed = (await api.getLog({ types: ['roleClosed'] }))[0];
    expect(closed.participantId).toBeNull();
    expect(closed.role).toBe('A'); // l'ultimo chiuso dei quattro
    expect(closed.detail).toContain('Attaccanti');

    // Paginazione col cursore e filtro per squadra.
    const page = await api.getLog({ take: 3 });
    expect(page).toHaveLength(3);
    const older = await api.getLog({ before: page.at(-1)!.seq, take: 3 });
    expect(older[0].seq).toBe(page.at(-1)!.seq - 1);
    expect(await api.getLog({ participantId: 'p9-inesistente' })).toEqual([]);

    // Nello snapshot viaggia solo la coda recente, in testa alla storia.
    const snap = await api.getState();
    expect(snap.log.length).toBeLessThanOrEqual(LOG_TAIL);
    expect(snap.log[0].seq).toBe(log[0].seq);
  });
});

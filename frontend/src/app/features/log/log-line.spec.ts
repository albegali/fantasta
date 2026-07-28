import { AuctionLogEntry, AuctionLogType } from '../../core/auction-events';
import { toLogLine } from './log-line';

const entry = (type: AuctionLogType, patch: Partial<AuctionLogEntry> = {}): AuctionLogEntry => ({
  seq: 1,
  type,
  at: new Date('2026-07-27T21:05:00').getTime(),
  participantId: 'p1',
  teamName: 'FC Test',
  playerId: 7,
  playerName: 'Rossi',
  role: 'A',
  price: 12,
  detail: null,
  ...patch,
});

describe('toLogLine', () => {
  it('racconta chi ha comprato cosa e a quanto', () => {
    const line = toLogLine(entry('assigned', { price: 34, detail: '3 rilanci' }));
    expect(line.text).toBe('Rossi a FC Test');
    expect(line.amount).toBe(34);
    expect(line.note).toBe('3 rilanci');
    expect(line.kind).toBe('purchase');
    expect(line.time).toBe('21:05');
  });

  it('distingue chiamata e rilancio', () => {
    expect(toLogLine(entry('nominate', { price: 1 })).text).toBe('FC Test chiama Rossi');
    expect(toLogLine(entry('bid')).text).toBe('FC Test rilancia su Rossi');
    expect(toLogLine(entry('bid')).kind).toBe('bid');
  });

  it('sulla riapertura dice a chi è andato il rimborso e da dove si ribatte', () => {
    const line = toLogLine(entry('reopen', { price: 34, detail: 'si ribatte da 1' }));
    expect(line.text).toBe("Lotto riaperto: Rossi torna all'asta");
    expect(line.note).toBe('rimborsata FC Test, si ribatte da 1');
    expect(line.amount).toBe(34);
    expect(line.kind).toBe('admin');
  });

  it('sul turno saltato dice se c’era un lotto da annullare', () => {
    // Senza lotto aperto il server non manda nessun calciatore.
    expect(toLogLine(entry('skip', { playerName: null, playerId: null })).text).toBe(
      'Turno di FC Test saltato',
    );
    expect(
      toLogLine(entry('skip', { playerName: 'Bianchi', detail: 'lotto annullato' })).text,
    ).toBe('Turno di FC Test saltato, Bianchi annullato');
  });

  it('le righe di fase non mostrano crediti', () => {
    const filling = toLogLine(entry('filling', { price: 1, playerName: null, teamName: null }));
    expect(filling.text).toBe('Svincoli aperti: rose da completare');
    expect(filling.note).toBe('1 credito a testa');
    expect(filling.amount).toBeNull();
    expect(toLogLine(entry('finished')).amount).toBeNull();
    expect(toLogLine(entry('pause')).kind).toBe('phase');
  });

  it('il reparto chiuso porta il dettaglio del server', () => {
    const line = toLogLine(
      entry('roleClosed', {
        participantId: null,
        teamName: null,
        playerName: null,
        playerId: null,
        role: 'P',
        price: null,
        detail: 'Portieri, 3 slot lasciati vuoti',
      }),
    );
    expect(line.text).toBe('Reparto chiuso in anticipo');
    expect(line.note).toBe('Portieri, 3 slot lasciati vuoti');
  });

  it('resta leggibile se la squadra non c’è più', () => {
    const line = toLogLine(entry('assigned', { teamName: null }));
    expect(line.text).toBe('Rossi a Una squadra');
  });
});

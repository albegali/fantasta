/**
 * Test del port client del motore (`environment.useMock`). I test "veri" delle
 * regole vivono su `backend/src/auction/auction-engine.spec.ts`: qui verifichiamo
 * solo che il port non abbia perso pezzi rispetto al prototipo.
 */

import { AuctionRules, AuctionState, FILLING_PRICE, Participant, Player } from '../auction-events';
import {
  Verdict,
  applyClaim,
  canClaim,
  canNominate,
  computeMaxBid,
  currentRole,
  isFinished,
  needsFilling,
  nextTurn,
  remainingSlotsInRole,
  slotsLeft,
  validateBid,
} from './auction-engine';

/** Il codice di rifiuto, o `null` se il verdetto era positivo. */
const codeOf = (verdict: Verdict): string | null => (verdict.ok ? null : verdict.code);

const RULES: AuctionRules = {
  leagueName: 'Test',
  auctionName: 'Test',
  budget: 300,
  rosterSlots: { P: 1, D: 1, C: 1, A: 1 },
  callOrder: 'free',
  bidTimerSeconds: 5,
  startPriceMode: 'fixed',
  startPrice: 1,
  releaseRefund: 'purchase',
};

const participant = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  name: id,
  teamName: `Team ${id}`,
  avatarUrl: null,
  budget: 300,
  spent: 0,
  roster: [],
  online: true,
  ...over,
});

const player: Player = { id: 1, name: 'Maignan', team: 'Milan', role: 'P', quotation: 16 };

const state = (over: Partial<AuctionState> = {}): AuctionState => ({
  status: 'IDLE',
  rules: RULES,
  participants: [participant('a'), participant('b')],
  turnOrder: ['a', 'b'],
  currentTurnParticipantId: 'a',
  currentRole: null,
  closedRoles: [],
  lot: null,
  lastAssigned: null,
  repairRound: 0,
  releases: [],
  log: [],
  ...over,
});

describe('auction-engine (port client)', () => {
  it('riserva un credito per ogni slot ancora da riempire', () => {
    const p = participant('a', { budget: 300 });
    expect(slotsLeft(p, RULES)).toBe(4);
    // 4 slot liberi → devo conservare 3 crediti per gli altri.
    expect(computeMaxBid(p, RULES)).toBe(297);
  });

  it('con callOrder fixed blocca i ruoli fuori dal reparto corrente', () => {
    const st = state({ rules: { ...RULES, callOrder: 'fixed' } });
    expect(currentRole(st)).toBe('P');
    expect(codeOf(canNominate(st, 'a', { ...player, id: 2, role: 'A' }))).toBe('ROLE_LOCKED');
  });

  it('rifiuta la chiamata di chi non è di turno', () => {
    expect(codeOf(canNominate(state(), 'b', player))).toBe('NOT_YOUR_TURN');
  });

  it('accetta la chiamata valida al prezzo base', () => {
    const verdict = canNominate(state(), 'a', player);
    expect(verdict).toEqual({ ok: true, price: 1 });
  });

  it('rifiuta i rilanci non superiori e quelli del miglior offerente', () => {
    const st = state({
      status: 'BIDDING',
      lot: {
        player,
        byParticipantId: 'a',
        price: 10,
        bestParticipantId: 'a',
        endsAt: Date.now() + 5000,
        history: [],
      },
    });
    expect(codeOf(validateBid(st, 'a', 20))).toBe('ALREADY_BEST');
    expect(codeOf(validateBid(st, 'b', 10))).toBe('BID_TOO_LOW');
    expect(validateBid(st, 'b', 11)).toEqual({ ok: true, price: 11 });
  });

  it('rifiuta il rilancio oltre il massimo consentito', () => {
    const poor = participant('b', { budget: 5 });
    const st = state({
      status: 'BIDDING',
      participants: [participant('a'), poor],
      lot: {
        player,
        byParticipantId: 'a',
        price: 3,
        bestParticipantId: 'a',
        endsAt: Date.now() + 5000,
        history: [],
      },
    });
    // budget 5, 4 slot liberi → maxBid 2, quindi 4 è già fuori.
    expect(codeOf(validateBid(st, 'b', 4))).toBe('INSUFFICIENT_CREDITS');
  });

  it('con callOrder fixed salta chi ha già saturato il reparto in corso', () => {
    const withP = (id: string): Participant =>
      participant(id, { roster: [{ playerId: 9, name: 'p', team: 't', role: 'P', price: 1 }] });

    const st = state({
      rules: { ...RULES, callOrder: 'fixed' },
      participants: [participant('a'), withP('b'), participant('c')],
      turnOrder: ['a', 'b', 'c'],
      currentTurnParticipantId: 'a',
    });

    expect(currentRole(st)).toBe('P');
    // `b` ha il portiere: viene saltato finché la lega non passa ai difensori.
    expect(nextTurn(st)).toBe('c');
  });

  it('con callOrder free non salta nessuno per reparto', () => {
    const withP = (id: string): Participant =>
      participant(id, { roster: [{ playerId: 9, name: 'p', team: 't', role: 'P', price: 1 }] });

    const st = state({
      participants: [participant('a'), withP('b'), participant('c')],
      turnOrder: ['a', 'b', 'c'],
      currentTurnParticipantId: 'a',
    });

    expect(currentRole(st)).toBeNull();
    expect(nextTurn(st)).toBe('b');
  });

  it('cambiato reparto, chi era saltato torna in turno', () => {
    const entry = (playerId: number, role: 'P' | 'D') => ({
      playerId,
      name: 'x',
      team: 't',
      role,
      price: 1,
    });
    // Tutti hanno il portiere → il reparto in corso passa ai difensori, e `b`
    // (che era stato saltato sui portieri) è di nuovo chiamabile.
    const st = state({
      rules: { ...RULES, callOrder: 'fixed' },
      participants: [
        participant('a', { roster: [entry(1, 'P')] }),
        participant('b', { roster: [entry(2, 'P')] }),
        participant('c', { roster: [entry(3, 'P')] }),
      ],
      turnOrder: ['a', 'b', 'c'],
      currentTurnParticipantId: 'a',
    });

    expect(currentRole(st)).toBe('D');
    expect(nextTurn(st)).toBe('b');
  });

  it('un reparto chiuso dall’admin non torna all’asta', () => {
    const entry = { playerId: 9, name: 'p', team: 't', role: 'P' as const, price: 1 };
    // `a` ha il portiere, `b` no: normalmente il reparto resterebbe P…
    const base = {
      rules: { ...RULES, callOrder: 'fixed' as const },
      participants: [participant('a', { roster: [entry] }), participant('b')],
      turnOrder: ['a', 'b'],
      currentTurnParticipantId: 'a',
    };
    expect(currentRole(state(base))).toBe('P');
    expect(remainingSlotsInRole(state(base), 'P')).toBe(1);

    // …ma chiuso P si passa a D, e `b` resta con un buco da svincolare.
    const closed = state({ ...base, closedRoles: ['P'] });
    expect(currentRole(closed)).toBe('D');
    expect(nextTurn(closed)).toBe('b');
    expect(needsFilling(closed)).toBe(false); // resta D da battere
  });

  it('chiusi tutti i reparti con rose incomplete si aprono gli svincoli', () => {
    const st = state({
      rules: { ...RULES, callOrder: 'fixed' },
      participants: [participant('a')],
      turnOrder: ['a'],
      currentTurnParticipantId: 'a',
      closedRoles: ['P', 'D', 'C', 'A'],
    });
    expect(currentRole(st)).toBeNull();
    expect(isFinished(st)).toBe(false);
    expect(needsFilling(st)).toBe(true);
  });

  it('lo svincolo accetta qualsiasi reparto scoperto e costa il prezzo fisso', () => {
    const filling = state({
      status: 'FILLING',
      participants: [participant('a')],
      turnOrder: ['a'],
      currentTurnParticipantId: 'a',
    });
    expect(canClaim(filling, 'a', player, FILLING_PRICE)).toEqual({ ok: true, price: 1 });

    // Fuori dalla fase svincoli non si pesca.
    expect(codeOf(canClaim(state(), 'a', player, FILLING_PRICE))).toBe('NOT_FILLING');

    // Reparto già pieno: no.
    const full = state({
      status: 'FILLING',
      participants: [
        participant('a', {
          roster: [{ playerId: 5, name: 'x', team: 't', role: 'P', price: 1 }],
        }),
      ],
      turnOrder: ['a'],
      currentTurnParticipantId: 'a',
    });
    expect(codeOf(canClaim(full, 'a', player, FILLING_PRICE))).toBe('ROLE_FULL');

    // Senza crediti nemmeno per uno svincolo: no.
    const broke = state({
      status: 'FILLING',
      participants: [participant('a', { budget: 0 })],
      turnOrder: ['a'],
      currentTurnParticipantId: 'a',
    });
    expect(codeOf(canClaim(broke, 'a', player, FILLING_PRICE))).toBe('INSUFFICIENT_CREDITS');
  });

  it('applyClaim aggiunge alla rosa e scala il budget', () => {
    const filling = state({
      status: 'FILLING',
      participants: [participant('a')],
      turnOrder: ['a'],
      currentTurnParticipantId: 'a',
    });
    const { participants, assigned } = applyClaim(filling, 'a', player, FILLING_PRICE);
    expect(assigned).toEqual({
      playerId: player.id,
      playerName: player.name,
      participantId: 'a',
      teamName: 'Team a',
      price: 1,
    });
    expect(participants[0].roster).toHaveLength(1);
    expect(participants[0].budget).toBe(299);
    expect(participants[0].spent).toBe(1);
  });

  it('salta chi ha la rosa completa e chiude quando sono tutti pieni', () => {
    const full = (id: string): Participant =>
      participant(id, {
        roster: [
          { playerId: 1, name: 'x', team: 't', role: 'P', price: 1 },
          { playerId: 2, name: 'y', team: 't', role: 'D', price: 1 },
          { playerId: 3, name: 'z', team: 't', role: 'C', price: 1 },
          { playerId: 4, name: 'w', team: 't', role: 'A', price: 1 },
        ],
      });

    const st = state({ participants: [participant('a'), full('b')] });
    expect(nextTurn(st)).toBe('a');
    expect(isFinished(st)).toBe(false);
    expect(isFinished(state({ participants: [full('a'), full('b')] }))).toBe(true);
  });
});

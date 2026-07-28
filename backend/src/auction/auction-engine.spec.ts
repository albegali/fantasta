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
  canTakeTurn,
  canUnrelease,
  computeMaxBid,
  currentRole,
  isFinished,
  needsFilling,
  nextTurn,
  refundFor,
  remainingSlotsInRole,
  slotsLeft,
  slotsUsed,
  startPriceFor,
  turnFrom,
  validateBid,
} from './auction-engine';
import {
  AuctionRules,
  AuctionState,
  FILLING_PRICE,
  Participant,
  Player,
  Role,
  RosterEntry,
} from './dto/events';

const RULES: AuctionRules = {
  leagueName: 'Lega Test',
  auctionName: 'Asta Test',
  budget: 300,
  rosterSlots: { P: 3, D: 8, C: 8, A: 6 }, // 25 slot
  callOrder: 'fixed',
  bidTimerSeconds: 5,
  startPriceMode: 'fixed',
  startPrice: 1,
  releaseRefund: 'purchase',
};

const player = (id: number, role: Role, quotation = 10): Player => ({
  id,
  name: `Player ${id}`,
  team: 'Squadra',
  role,
  quotation,
});

const entry = (id: number, role: Role, price = 1): RosterEntry => ({
  playerId: id,
  name: `Player ${id}`,
  team: 'Squadra',
  role,
  price,
});

/** Partecipante con la rosa data: budget e `spent` coerenti con gli acquisti. */
const fresh = (id: string, roster: RosterEntry[] = []): Participant => {
  const spent = roster.reduce((n, r) => n + r.price, 0);
  return {
    id,
    name: id.toUpperCase(),
    teamName: `FC ${id}`,
    avatarUrl: null,
    budget: RULES.budget - spent,
    spent,
    roster,
    online: true,
    accessCode: `CODE${id}`,
  };
};

/** Rosa con `count` acquisti in un reparto, a 1 credito l'uno. */
const withRole = (id: string, role: Role, count: number, offset = 0): Participant =>
  fresh(
    id,
    Array.from({ length: count }, (_, i) => entry(offset + i + 1, role)),
  );

/** Rosa completa: 25 slot riempiti. */
const completeRoster = (): RosterEntry[] => [
  ...Array.from({ length: 3 }, (_, i) => entry(i + 1, 'P')),
  ...Array.from({ length: 8 }, (_, i) => entry(i + 10, 'D')),
  ...Array.from({ length: 8 }, (_, i) => entry(i + 20, 'C')),
  ...Array.from({ length: 6 }, (_, i) => entry(i + 30, 'A')),
];

const state = (participants: Participant[], patch: Partial<AuctionState> = {}): AuctionState => ({
  status: 'IDLE',
  rules: RULES,
  participants,
  turnOrder: participants.map((p) => p.id),
  currentTurnParticipantId: participants[0]?.id ?? '',
  currentRole: null,
  closedRoles: [],
  lot: null,
  lastAssigned: null,
  repairRound: 0,
  releases: [],
  log: [],
  ...patch,
});

describe('auction-engine', () => {
  describe('slot e budget', () => {
    it('conta gli slot usati per reparto', () => {
      const p = fresh('a', [entry(1, 'P'), entry(2, 'D'), entry(3, 'D')]);
      expect(slotsUsed(p)).toEqual({ P: 1, D: 2, C: 0, A: 0 });
      expect(slotsLeft(p, RULES)).toBe(22);
    });

    it('maxBid riserva 1 credito per ogni slot residuo', () => {
      // 25 slot: comprandone 1 devo tenere 24 crediti → max 276
      expect(computeMaxBid(fresh('a'), RULES)).toBe(276);
    });

    it('sull’ultimo slot si può spendere tutto il residuo', () => {
      const almost = fresh('a', completeRoster().slice(0, 24));
      expect(slotsLeft(almost, RULES)).toBe(1);
      expect(computeMaxBid(almost, RULES)).toBe(almost.budget);
    });
  });

  describe('prezzo base della chiamata', () => {
    it('usa la regola di lega, o la quotazione con `startPriceMode: quotation`', () => {
      expect(startPriceFor(RULES, player(1, 'P', 16))).toBe(1);
      expect(startPriceFor({ ...RULES, startPriceMode: 'quotation' }, player(1, 'P', 16))).toBe(16);
    });

    it('il chiamante può alzarlo, mai scendere sotto 1', () => {
      expect(startPriceFor(RULES, player(1, 'P'), 12)).toBe(12);
      expect(startPriceFor(RULES, player(1, 'P'), 0)).toBe(1);
    });
  });

  describe('canNominate', () => {
    it('accetta la chiamata di chi è di turno', () => {
      const s = state([fresh('a'), fresh('b')]);
      expect(canNominate(s, 'a', player(1, 'P'))).toEqual({ ok: true, price: 1 });
    });

    it('rifiuta chi non è di turno, la pausa e il lotto aperto', () => {
      const s = state([fresh('a'), fresh('b')]);
      expect(canNominate(s, 'b', player(1, 'P'))).toMatchObject({ code: 'NOT_YOUR_TURN' });
      expect(canNominate({ ...s, status: 'PAUSED' }, 'a', player(1, 'P'))).toMatchObject({
        code: 'PAUSED',
      });
      const bidding = state([fresh('a')], {
        status: 'BIDDING',
        lot: {
          player: player(9, 'P'),
          byParticipantId: 'a',
          price: 3,
          bestParticipantId: 'a',
          endsAt: Date.now() + 5000,
          history: [],
        },
      });
      expect(canNominate(bidding, 'a', player(1, 'P'))).toMatchObject({ code: 'LOT_OPEN' });
    });

    it('rifiuta durante gli svincoli e a asta finita', () => {
      const s = state([fresh('a')]);
      expect(canNominate({ ...s, status: 'FILLING' }, 'a', player(1, 'P'))).toMatchObject({
        code: 'NOT_IDLE',
      });
      expect(canNominate({ ...s, status: 'FINISHED' }, 'a', player(1, 'P'))).toMatchObject({
        code: 'ALREADY_COMPLETE',
      });
    });

    it('rifiuta giocatore inesistente, già preso e reparto saturo', () => {
      const s = state([fresh('a', [entry(7, 'P')]), fresh('b')]);
      expect(canNominate(s, 'a', undefined)).toMatchObject({ code: 'UNKNOWN_PLAYER' });
      expect(canNominate(s, 'a', player(7, 'P'))).toMatchObject({ code: 'PLAYER_TAKEN' });

      // Reparto in corso P (b ha ancora slot) ma `a` l'ha già saturato.
      const full = state([withRole('a', 'P', 3), fresh('b')]);
      expect(canNominate(full, 'a', player(50, 'P'))).toMatchObject({ code: 'ROLE_FULL' });
    });

    it('con `fixed` blocca i ruoli fuori dal reparto in corso', () => {
      expect(canNominate(state([fresh('a')]), 'a', player(1, 'D'))).toMatchObject({
        code: 'ROLE_LOCKED',
      });
      const free = state([fresh('a')], { rules: { ...RULES, callOrder: 'free' } });
      expect(canNominate(free, 'a', player(1, 'D')).ok).toBe(true);
    });

    it('rifiuta il prezzo base oltre il massimo', () => {
      const s = state([{ ...fresh('a'), budget: 10 }], {
        rules: { ...RULES, startPriceMode: 'quotation' },
      });
      // maxBid = 10 - 24 → 0: qualsiasi quotazione è fuori portata.
      expect(canNominate(s, 'a', player(1, 'P', 16))).toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });
  });

  describe('validateBid', () => {
    const bidding = (price = 5, best = 'a'): AuctionState =>
      state([fresh('a'), fresh('b'), withRole('c', 'P', 3)], {
        status: 'BIDDING',
        lot: {
          player: player(1, 'P'),
          byParticipantId: 'a',
          price,
          bestParticipantId: best,
          endsAt: Date.now() + 5000,
          history: [],
        },
      });

    it('accetta un rilancio più alto', () => {
      expect(validateBid(bidding(), 'b', 6)).toEqual({ ok: true, price: 6 });
    });

    it('rifiuta pari o inferiore, non intero, e chi vince già', () => {
      expect(validateBid(bidding(), 'b', 5)).toMatchObject({ code: 'BID_TOO_LOW' });
      expect(validateBid(bidding(), 'b', 5.5)).toMatchObject({ code: 'BID_INVALID' });
      expect(validateBid(bidding(), 'a', 6)).toMatchObject({ code: 'ALREADY_BEST' });
    });

    it('rifiuta senza lotto aperto, in pausa e a reparto saturo', () => {
      expect(validateBid(state([fresh('a')]), 'a', 3)).toMatchObject({ code: 'NOT_BIDDING' });
      expect(validateBid({ ...bidding(), status: 'PAUSED' }, 'b', 6)).toMatchObject({
        code: 'PAUSED',
      });
      expect(validateBid(bidding(), 'c', 6)).toMatchObject({ code: 'ROLE_FULL' });
    });

    it('rifiuta oltre il massimo consentito', () => {
      const s = bidding();
      s.participants = s.participants.map((p) => (p.id === 'b' ? { ...p, budget: 30 } : p));
      // maxBid di b = 30 - 24 = 6
      expect(validateBid(s, 'b', 6).ok).toBe(true);
      expect(validateBid(s, 'b', 7)).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    });
  });

  describe("callOrder 'fixed': il reparto è uno per tutta la lega", () => {
    it('è il primo ruolo di cui qualcuno ha ancora bisogno', () => {
      expect(currentRole(state([fresh('a'), fresh('b')]))).toBe('P');
      // `a` ha finito i portieri ma `b` no: il reparto resta P per tutti.
      expect(currentRole(state([withRole('a', 'P', 3), fresh('b')]))).toBe('P');
      // Finiti da tutti: si passa ai difensori.
      expect(currentRole(state([withRole('a', 'P', 3), withRole('b', 'P', 3, 10)]))).toBe('D');
    });

    it('è null con ordine libero', () => {
      const free = state([fresh('a')], { rules: { ...RULES, callOrder: 'free' } });
      expect(currentRole(free)).toBeNull();
    });

    it('chi ha saturato il reparto in corso non prende il turno', () => {
      const done = withRole('a', 'P', 3);
      expect(canTakeTurn(done, RULES, 'P')).toBe(false);
      expect(canTakeTurn(done, RULES, 'D')).toBe(true); // cambiato reparto, rientra
      expect(canTakeTurn(done, RULES, null)).toBe(true); // ordine libero
    });

    it('nextTurn salta chi ha il reparto pieno', () => {
      const s = state([fresh('a'), withRole('b', 'P', 3, 10), fresh('c')]);
      expect(nextTurn(s)).toBe('c'); // `b` saltato: portieri già a posto
      expect(turnFrom(s, 1)).toBe('c');
      // Con ordine libero `b` rientra nel giro.
      expect(nextTurn({ ...s, rules: { ...RULES, callOrder: 'free' } })).toBe('b');
    });

    it('nextTurn gira in tondo e torna al primo', () => {
      const s = state([fresh('a'), fresh('b')], { currentTurnParticipantId: 'b' });
      expect(nextTurn(s)).toBe('a');
    });

    it('chi ha la rosa completa è sempre fuori dai turni', () => {
      const s = state([fresh('a', completeRoster())]);
      expect(canTakeTurn(s.participants[0], RULES, null)).toBe(false);
      expect(currentRole(s)).toBeNull();
      expect(isFinished(s)).toBe(true);
      expect(nextTurn(s)).toBeNull();
    });
  });

  describe('reparto chiuso in anticipo dall’admin', () => {
    it('non torna all’asta: il reparto in corso passa al successivo', () => {
      const a = withRole('a', 'P', 1);
      expect(currentRole(state([a]))).toBe('P');
      expect(remainingSlotsInRole(state([a]), 'P')).toBe(2);
      expect(currentRole(state([a], { closedRoles: ['P'] }))).toBe('D');
    });

    it('conta gli slot rimasti su tutta la lega', () => {
      const s = state([withRole('a', 'P', 3), withRole('b', 'P', 1, 10)]);
      expect(remainingSlotsInRole(s, 'P')).toBe(2); // solo quelli di `b`
    });

    it('chiusi tutti i reparti non resta nulla da battere: svincoli', () => {
      const s = state([withRole('a', 'P', 1)], { closedRoles: ['P', 'D', 'C', 'A'] });
      expect(currentRole(s)).toBeNull();
      expect(isFinished(s)).toBe(false);
      expect(needsFilling(s)).toBe(true);
      expect(needsFilling(state([withRole('a', 'P', 1)]))).toBe(false);
    });
  });

  describe('svincoli finali a prezzo fisso', () => {
    const filling = (participants: Participant[]): AuctionState =>
      state(participants, { status: 'FILLING', closedRoles: ['P', 'D', 'C', 'A'] });

    it('accetta un rimasto in qualunque reparto scoperto', () => {
      const s = filling([withRole('a', 'P', 1)]);
      expect(canClaim(s, 'a', player(90, 'P'), FILLING_PRICE)).toEqual({ ok: true, price: 1 });
      expect(canClaim(s, 'a', player(91, 'A'), FILLING_PRICE)).toEqual({ ok: true, price: 1 });
    });

    it('rifiuta fuori fase, già preso, reparto pieno e senza crediti', () => {
      expect(canClaim(state([fresh('a')]), 'a', player(1, 'A'), 1)).toMatchObject({
        code: 'NOT_FILLING',
      });
      const s = filling([fresh('a', [entry(1, 'A')]), withRole('b', 'P', 3, 10)]);
      expect(canClaim(s, 'a', player(1, 'A'), 1)).toMatchObject({ code: 'PLAYER_TAKEN' });
      expect(canClaim(s, 'b', player(2, 'P'), 1)).toMatchObject({ code: 'ROLE_FULL' });
      const alVerde = filling([{ ...fresh('c'), budget: 0 }]);
      expect(canClaim(alVerde, 'c', player(3, 'A'), 1)).toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
    });
  });

  describe('assegnazione', () => {
    it('applyAssignment dà il lotto al miglior offerente e aggiorna budget/rosa', () => {
      const s = state([fresh('a'), fresh('b')], {
        status: 'BIDDING',
        lot: {
          player: player(1, 'P', 16),
          byParticipantId: 'a',
          price: 20,
          bestParticipantId: 'b',
          endsAt: Date.now(),
          history: [],
        },
      });
      const { participants, assigned } = applyAssignment(s);
      const winner = participants.find((p) => p.id === 'b')!;
      expect(assigned).toEqual({
        playerId: 1,
        playerName: 'Player 1',
        participantId: 'b',
        teamName: 'FC b',
        price: 20,
      });
      expect(winner.budget).toBe(280);
      expect(winner.spent).toBe(20);
      expect(winner.roster).toHaveLength(1);
      // Immutabile: lo stato di partenza non è stato toccato.
      expect(s.participants.find((p) => p.id === 'b')!.roster).toHaveLength(0);
    });

    it('senza rilanci il lotto va al chiamante', () => {
      const s = state([fresh('a')], {
        status: 'BIDDING',
        lot: {
          player: player(1, 'P'),
          byParticipantId: 'a',
          price: 1,
          bestParticipantId: 'a',
          endsAt: Date.now(),
          history: [],
        },
      });
      expect(applyAssignment(s).assigned).toMatchObject({ participantId: 'a', price: 1 });
    });

    it('applyPurchase non tocca gli altri partecipanti', () => {
      const s = state([fresh('a'), fresh('b')]);
      const { participants } = applyPurchase(s, 'a', player(4, 'C'), 7);
      expect(participants.find((p) => p.id === 'b')).toBe(s.participants[1]);
    });

    it('applyRefund è l’inverso di applyPurchase', () => {
      const s = state([fresh('a'), fresh('b')]);
      const bought = applyPurchase(s, 'a', player(4, 'C'), 30).participants;
      const after = applyRefund({ ...s, participants: bought }, 'a', 4);
      const back = after.participants.find((p) => p.id === 'a')!;
      expect(after.price).toBe(30);
      expect(back.budget).toBe(RULES.budget);
      expect(back.spent).toBe(0);
      expect(back.roster).toHaveLength(0);
      // Immutabile: la rosa da cui siamo partiti non è stata svuotata.
      expect(bought.find((p) => p.id === 'a')!.roster).toHaveLength(1);
    });

    it('applyRefund su un giocatore che non è in rosa è un errore di programmazione', () => {
      const s = state([fresh('a')]);
      expect(() => applyRefund(s, 'a', 99)).toThrow();
    });

    it('canHoldLot: serve lo slot libero e i crediti per il prezzo base', () => {
      const s = state([withRole('a', 'P', 3), { ...fresh('b'), budget: 30 }]);
      expect(canHoldLot(s, 'a', player(50, 'P'), 1)).toBe(false); // reparto pieno
      expect(canHoldLot(s, 'a', player(50, 'D'), 1)).toBe(true);
      expect(canHoldLot(s, 'b', player(50, 'P'), 6)).toBe(true); // maxBid = 30 - 24
      expect(canHoldLot(s, 'b', player(50, 'P'), 7)).toBe(false);
      expect(canHoldLot(s, null, player(50, 'P'), 1)).toBe(false);
      expect(canHoldLot(s, 'ignoto', player(50, 'P'), 1)).toBe(false);
    });

    it('l’assegnazione manuale ignora il reparto ma non slot e crediti', () => {
      const s = state([fresh('a')]); // reparto in corso: P
      expect(canAssignManual(s, 'a', player(1, 'A'), 30).ok).toBe(true);
      expect(canAssignManual(s, 'a', player(1, 'A'), 999)).toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
      });
      expect(canAssignManual(s, 'ignoto', player(1, 'A'), 1)).toMatchObject({
        code: 'UNKNOWN_PARTICIPANT',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Mercato di riparazione
  // ---------------------------------------------------------------------------
  describe('rimborso dello svincolo', () => {
    it('applica la regola di lega', () => {
      expect(refundFor('none', 40, 12)).toBe(0);
      expect(refundFor('purchase', 40, 12)).toBe(40);
      expect(refundFor('quotation', 40, 12)).toBe(12);
      expect(refundFor('average', 40, 12)).toBe(26);
    });

    it('la media arrotonda per difetto: i crediti sono interi', () => {
      expect(refundFor('average', 10, 15)).toBe(12); // 12,5 → 12
      expect(refundFor('average', 1, 2)).toBe(1); // 1,5 → 1
      expect(refundFor('average', 0, 1)).toBe(0);
    });
  });

  describe('canRelease', () => {
    /** Rosa completa a 1 credito l'uno: 25 spesi, 275 residui. */
    const releasing = (patch: Partial<Participant> = {}) =>
      state([{ ...fresh('a', completeRoster()), ...patch }, fresh('b')], {
        status: 'RELEASING',
        repairRound: 1,
      });

    it('accetta il taglio di un proprio giocatore a finestra aperta', () => {
      expect(canRelease(releasing(), 'a', 1, 1)).toEqual({ ok: true, price: 1 });
    });

    it('rifiuta fuori dalla finestra di svincolo', () => {
      const s = state([fresh('a', completeRoster())], { status: 'IDLE' });
      expect(canRelease(s, 'a', 1, 1)).toMatchObject({ code: 'NOT_RELEASING' });
    });

    it('si taglia solo dalla propria rosa', () => {
      const s = releasing();
      expect(canRelease(s, 'b', 1, 1)).toMatchObject({ code: 'NOT_IN_ROSTER' });
      expect(canRelease(s, 'a', 999, 1)).toMatchObject({ code: 'NOT_IN_ROSTER' });
      expect(canRelease(s, 'ignoto', 1, 1)).toMatchObject({ code: 'UNKNOWN_PARTICIPANT' });
    });

    /**
     * La guardia anti-stallo: senza crediti per riempire lo slot che si libera,
     * la rosa non sarebbe più completabile nemmeno agli svincoli a 1 credito e
     * l'asta si pianterebbe in `FILLING`.
     */
    it('rifiuta il taglio che renderebbe la rosa non completabile', () => {
      // Rosa piena e zero crediti: con `releaseRefund: none` non si taglia.
      const broke = releasing({ budget: 0 });
      expect(canRelease(broke, 'a', 1, 0)).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
      // Con 1 credito di rimborso lo slot liberato è ricopribile: passa.
      expect(canRelease(broke, 'a', 1, 1).ok).toBe(true);
    });

    it('conta gli slot già vuoti, non solo quello che si sta liberando', () => {
      // 23 acquisti su 25: 2 slot vuoti. Tagliandone uno diventano 3 → servono 3 crediti.
      const s = state([{ ...fresh('a', completeRoster().slice(0, 23)), budget: 2 }], {
        status: 'RELEASING',
        repairRound: 1,
      });
      expect(canRelease(s, 'a', 1, 0)).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
      expect(canRelease(s, 'a', 1, 1).ok).toBe(true);
    });
  });

  describe('applyRelease / applyUnrelease', () => {
    const s = () =>
      state([fresh('a', [entry(1, 'P', 40), entry(2, 'D', 5)])], {
        status: 'RELEASING',
        repairRound: 1,
      });

    it('il taglio libera lo slot e accredita il rimborso, non il prezzo', () => {
      const before = s();
      const { participants, released } = applyRelease(before, 'a', 1, 12); // quotazione
      const a = participants.find((p) => p.id === 'a')!;
      expect(a.roster.map((r) => r.playerId)).toEqual([2]);
      expect(a.budget).toBe(before.participants[0].budget + 12);
      expect(a.spent).toBe(before.participants[0].spent - 40); // lo speso segue il prezzo
      expect(released).toMatchObject({ playerId: 1, price: 40, refund: 12, teamName: 'FC a' });
    });

    it('non muta lo stato di partenza', () => {
      const before = s();
      applyRelease(before, 'a', 1, 12);
      expect(before.participants[0].roster).toHaveLength(2);
    });

    it('svincolare un giocatore non in rosa è un errore di programmazione', () => {
      expect(() => applyRelease(s(), 'a', 99, 1)).toThrow();
    });

    /** Il giro completo deve tornare al punto di partenza, rimborso qualunque. */
    it('l’annullamento è l’inverso esatto del taglio', () => {
      const before = s();
      const { participants, released } = applyRelease(before, 'a', 1, 12);
      const after = applyUnrelease({ ...before, participants }, released).participants;
      const a = after.find((p) => p.id === 'a')!;
      expect(a.budget).toBe(before.participants[0].budget);
      expect(a.spent).toBe(before.participants[0].spent);
      expect(a.roster).toHaveLength(2);
      expect(a.roster.find((r) => r.playerId === 1)).toMatchObject({ price: 40, role: 'P' });
    });
  });

  describe('canUnrelease', () => {
    const released = {
      playerId: 1,
      name: 'Player 1',
      team: 'Squadra',
      role: 'P' as Role,
      participantId: 'a',
      teamName: 'FC a',
      price: 40,
      refund: 12,
    };
    const s = (patch: Partial<AuctionState> = {}) =>
      state([fresh('a'), fresh('b')], {
        status: 'RELEASING',
        repairRound: 1,
        releases: [released],
        ...patch,
      });

    it('accetta l’annullamento di un proprio taglio', () => {
      expect(canUnrelease(s(), 'a', 1)).toEqual({ ok: true, price: 12 });
    });

    it('a finestra chiusa il taglio è definitivo', () => {
      expect(canUnrelease(s({ status: 'IDLE' }), 'a', 1)).toMatchObject({
        code: 'NOT_RELEASING',
      });
    });

    it('non si annulla il taglio di un altro, né un taglio che non c’è', () => {
      expect(canUnrelease(s(), 'b', 1)).toMatchObject({ code: 'NOT_RELEASED' });
      expect(canUnrelease(s(), 'a', 99)).toMatchObject({ code: 'NOT_RELEASED' });
    });

    it('rifiuta se i crediti del rimborso sono già stati spesi', () => {
      const poor = state([{ ...fresh('a'), budget: 5 }], {
        status: 'RELEASING',
        repairRound: 1,
        releases: [released],
      });
      expect(canUnrelease(poor, 'a', 1)).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    });
  });

  describe('l’asta di riparazione riusa il motore dell’asta iniziale', () => {
    /** Due squadre complete; `a` ha tagliato un portiere, `b` un attaccante. */
    const afterCuts = () =>
      state(
        [
          fresh(
            'a',
            completeRoster().filter((r) => r.playerId !== 1),
          ),
          fresh(
            'b',
            completeRoster().filter((r) => r.playerId !== 30),
          ),
        ],
        { status: 'IDLE', repairRound: 1 },
      );

    it('il reparto in corso è il primo scoperto, saltando quelli pieni', () => {
      expect(currentRole(afterCuts())).toBe('P'); // D e C sono pieni per tutti
    });

    it('chi non ha buchi nel reparto in corso viene saltato nei turni', () => {
      const s = afterCuts();
      expect(canTakeTurn(s.participants[0], RULES, 'P')).toBe(true);
      expect(canTakeTurn(s.participants[1], RULES, 'P')).toBe(false); // a `b` manca un A
      expect(nextTurn(s)).toBe('a');
    });

    it('finita la riparazione l’asta si chiude come sempre', () => {
      expect(isFinished(afterCuts())).toBe(false);
      expect(isFinished(state([fresh('a', completeRoster())], { repairRound: 1 }))).toBe(true);
    });

    it('a finestra aperta non si chiama: l’asta non è ancora ripartita', () => {
      const s = state([fresh('a', completeRoster().slice(0, 24))], {
        status: 'RELEASING',
        repairRound: 1,
      });
      expect(canNominate(s, 'a', player(90, 'A'))).toMatchObject({ code: 'NOT_IDLE' });
    });
  });
});

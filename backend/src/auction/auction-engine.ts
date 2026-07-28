/**
 * MOTORE D'ASTA — funzioni PURE (nessun side-effect, nessun I/O).
 * Qui vive la logica di dominio: ordine chiamate, slot, budget, validazione
 * offerte, svincoli. Testabile in isolamento (vedi `auction-engine.spec.ts`).
 *
 * È la **verità** delle regole: `frontend/src/app/core/mock/auction-engine.ts` ne
 * è solo il gemello usa-e-getta che fa girare il mock offline.
 *
 * NOTA su callOrder 'fixed' — interpretazione **DI LEGA** (PLAN.md, decisione 12):
 * il reparto in corso è uno per tutti. Si completano i portieri per **tutti** i
 * partecipanti, poi i difensori, e così via (P→D→C→A). Chi ha già saturato il
 * reparto in corso viene **saltato** nel giro dei turni finché il reparto non cambia.
 */
import {
  AuctionRules,
  AuctionState,
  ErrorCode,
  LastAssigned,
  Participant,
  Player,
  ReleaseEntry,
  ReleaseRefund,
  Role,
  ROLES,
  RosterSlots,
} from './dto/events';

export const ROLE_LABEL: Record<Role, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

export const ROLE_LABEL_PLURAL: Record<Role, string> = {
  P: 'Portieri',
  D: 'Difensori',
  C: 'Centrocampisti',
  A: 'Attaccanti',
};

export type Verdict = { ok: true; price: number } | { ok: false; code: ErrorCode; message: string };

const err = (code: ErrorCode, message: string): Verdict => ({ ok: false, code, message });
const ok = (price: number): Verdict => ({ ok: true, price });

export function slotsUsed(participant: Participant): RosterSlots {
  const counts: RosterSlots = { P: 0, D: 0, C: 0, A: 0 };
  for (const entry of participant.roster) counts[entry.role] += 1;
  return counts;
}

/** Slot ancora da riempire nella rosa, su tutti i reparti. */
export function slotsLeft(participant: Participant, rules: AuctionRules): number {
  const used = slotsUsed(participant);
  return ROLES.reduce((n, role) => n + Math.max(0, rules.rosterSlots[role] - used[role]), 0);
}

/**
 * `maxBid = crediti residui - (slot ancora da riempire - 1)`: bisogna conservare
 * almeno 1 credito per ogni slot che resterà da riempire dopo questo acquisto.
 */
export function computeMaxBid(participant: Participant, rules: AuctionRules): number {
  return Math.max(0, participant.budget - Math.max(0, slotsLeft(participant, rules) - 1));
}

export function needsRole(participant: Participant, rules: AuctionRules, role: Role): boolean {
  return slotsUsed(participant)[role] < rules.rosterSlots[role];
}

export function isRosterComplete(participant: Participant, rules: AuctionRules): boolean {
  return slotsLeft(participant, rules) === 0;
}

/**
 * Con `callOrder: 'fixed'` si compra un reparto alla volta: P → D → C → A.
 * Salta i reparti che l'admin ha chiuso in anticipo: quelli non tornano all'asta,
 * i loro slot vuoti si riempiono negli svincoli finali.
 * `null` con `callOrder: 'free'`, o quando non resta nessun reparto da battere.
 */
export function currentRole(state: AuctionState): Role | null {
  if (state.rules.callOrder !== 'fixed') return null;
  const closed = state.closedRoles ?? [];
  return (
    ROLES.find(
      (role) =>
        !closed.includes(role) && state.participants.some((p) => needsRole(p, state.rules, role)),
    ) ?? null
  );
}

/** Slot ancora vuoti in un reparto su tutta la lega: serve all'admin per decidere. */
export function remainingSlotsInRole(state: AuctionState, role: Role): number {
  const capacity = state.rules.rosterSlots[role];
  return state.participants.reduce((n, p) => n + Math.max(0, capacity - slotsUsed(p)[role]), 0);
}

/**
 * Prezzo base di una chiamata. `startPriceMode` è una **regola di lega**; il
 * chiamante può alzarlo passando `requested` (PLAN.md, decisione 1).
 */
export function startPriceFor(rules: AuctionRules, player: Player, requested?: number): number {
  const base = rules.startPriceMode === 'quotation' ? player.quotation : rules.startPrice;
  return Math.max(1, requested ?? base);
}

export function isPlayerTaken(state: AuctionState, playerId: number): boolean {
  return state.participants.some((p) => p.roster.some((r) => r.playerId === playerId));
}

/**
 * Il partecipante può prendere il turno di chiamata? No se ha la rosa completa e —
 * in modalità `fixed` — nemmeno se ha già saturato il reparto in corso: in quel
 * caso aspetta che lo completino tutti gli altri.
 */
export function canTakeTurn(
  participant: Participant,
  rules: AuctionRules,
  leagueRole: Role | null,
): boolean {
  if (isRosterComplete(participant, rules)) return false;
  if (leagueRole && !needsRole(participant, rules, leagueRole)) return false;
  return true;
}

export function canNominate(
  state: AuctionState,
  participantId: string | null,
  player: Player | undefined,
  requestedPrice?: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (state.status === 'PAUSED') return err('PAUSED', 'Asta in pausa.');
  if (state.status === 'FINISHED') return err('ALREADY_COMPLETE', 'L’asta è terminata.');
  if (state.lot) return err('LOT_OPEN', 'C’è già un’asta in corso.');
  if (state.status === 'ASSIGNED') return err('LOT_OPEN', 'Aspetta la chiusura del lotto.');
  if (state.status === 'FILLING') return err('NOT_IDLE', 'Siamo agli svincoli: non si chiama più.');
  if (state.status === 'RELEASING') {
    return err('NOT_IDLE', 'Finestra di svincolo aperta: l’asta non è ancora ripartita.');
  }
  if (state.currentTurnParticipantId !== participantId) {
    return err('NOT_YOUR_TURN', 'Non è il tuo turno.');
  }
  if (!player) return err('UNKNOWN_PLAYER', 'Calciatore sconosciuto.');
  if (isPlayerTaken(state, player.id)) return err('PLAYER_TAKEN', 'Calciatore già assegnato.');
  if (!needsRole(p, state.rules, player.role)) return err('ROLE_FULL', 'Reparto già completo.');
  const role = currentRole(state);
  if (role && player.role !== role) {
    return err('ROLE_LOCKED', `Si sta completando il reparto ${ROLE_LABEL[role]}.`);
  }
  const price = startPriceFor(state.rules, player, requestedPrice);
  if (!Number.isInteger(price)) return err('BID_INVALID', 'Prezzo base non valido.');
  if (price > computeMaxBid(p, state.rules)) {
    return err('INSUFFICIENT_CREDITS', 'Crediti insufficienti.');
  }
  return ok(price);
}

export function validateBid(
  state: AuctionState,
  participantId: string | null,
  price: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (state.status === 'PAUSED') return err('PAUSED', 'Asta in pausa.');
  if (!state.lot || state.status !== 'BIDDING') return err('NOT_BIDDING', 'Nessuna asta aperta.');
  if (state.lot.bestParticipantId === participantId) {
    return err('ALREADY_BEST', 'Sei già il miglior offerente.');
  }
  if (!Number.isInteger(price)) return err('BID_INVALID', 'Offerta non valida.');
  if (price <= state.lot.price) return err('BID_TOO_LOW', 'Offerta troppo bassa.');
  if (!needsRole(p, state.rules, state.lot.player.role)) {
    return err('ROLE_FULL', 'Reparto già completo.');
  }
  if (price > computeMaxBid(p, state.rules)) {
    return err('INSUFFICIENT_CREDITS', 'Oltre il tuo massimo.');
  }
  return ok(price);
}

/**
 * Svincolo finale (`status: 'FILLING'`): prendo un rimasto a prezzo fisso, senza
 * asta e senza turni. Nessun vincolo di reparto — la fase serve proprio a chiudere
 * i buchi lasciati dai reparti chiusi in anticipo.
 */
export function canClaim(
  state: AuctionState,
  participantId: string | null,
  player: Player | undefined,
  price: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (state.status !== 'FILLING') return err('NOT_FILLING', 'Gli svincoli non sono aperti.');
  if (!player) return err('UNKNOWN_PLAYER', 'Calciatore sconosciuto.');
  if (isPlayerTaken(state, player.id)) return err('PLAYER_TAKEN', 'Calciatore già assegnato.');
  if (!needsRole(p, state.rules, player.role)) return err('ROLE_FULL', 'Reparto già completo.');
  if (p.budget < price) return err('INSUFFICIENT_CREDITS', `Ti serve almeno ${price} credito.`);
  return ok(price);
}

/* ---------------------------------------------------------------------------
 * MERCATO DI RIPARAZIONE
 *
 * La riparazione non ha un motore suo: si limita a **rimettere buchi** nelle rose
 * (la finestra di svincolo, `status: 'RELEASING'`) e poi riapre la sala. Da lì
 * tutto quel che c'è sopra funziona già com'è — `currentRole` trova il primo
 * reparto scoperto, `canTakeTurn` salta chi è pieno, `FILLING` chiude gli avanzi,
 * `isFinished` chiude l'asta.
 * ------------------------------------------------------------------------- */

/**
 * Crediti restituiti da uno svincolo. `quotation` è quella **attuale** di
 * listone, quindi un re-import a mercato aperto cambia i rimborsi: è voluto —
 * è il senso della regola (si rivende al valore di oggi, non a quello di agosto).
 */
export function refundFor(mode: ReleaseRefund, price: number, quotation: number): number {
  switch (mode) {
    case 'none':
      return 0;
    case 'quotation':
      return quotation;
    case 'average':
      return Math.floor((price + quotation) / 2);
    case 'purchase':
      return price;
  }
}

/**
 * Si può tagliare questo calciatore? Solo dalla propria rosa, solo a finestra
 * aperta, e solo se dopo il taglio la rosa resta **completabile**.
 *
 * Quest'ultimo vincolo è la guardia anti-stallo: il resto del motore dà per
 * buono che ognuno conservi almeno 1 credito per ogni slot vuoto
 * (`computeMaxBid`). Con `releaseRefund: 'none'` e i crediti finiti, tagliare
 * lascerebbe uno slot che il proprietario non può riempire nemmeno negli
 * svincoli a 1 credito: `isFinished` non diventerebbe mai vero e l'asta si
 * pianterebbe in `FILLING`. Meglio rifiutare il taglio.
 */
export function canRelease(
  state: AuctionState,
  participantId: string | null,
  playerId: number,
  refund: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (state.status !== 'RELEASING') {
    return err('NOT_RELEASING', 'La finestra di svincolo non è aperta.');
  }
  if (!p.roster.some((r) => r.playerId === playerId)) {
    return err('NOT_IN_ROSTER', 'Puoi svincolare solo dalla tua rosa.');
  }
  const slotsAfter = slotsLeft(p, state.rules) + 1;
  const budgetAfter = p.budget + refund;
  if (budgetAfter < slotsAfter) {
    return err(
      'INSUFFICIENT_CREDITS',
      `Dopo il taglio ti servirebbero ${slotsAfter} crediti per completare la rosa, ne avresti ${budgetAfter}.`,
    );
  }
  return ok(refund);
}

/** Annullabile finché la finestra è aperta: il taglio deve essere tuo. */
export function canUnrelease(
  state: AuctionState,
  participantId: string | null,
  playerId: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (state.status !== 'RELEASING') {
    return err('NOT_RELEASING', 'La finestra di svincolo è chiusa: il taglio è definitivo.');
  }
  const release = state.releases.find(
    (r) => r.playerId === playerId && r.participantId === participantId,
  );
  if (!release) return err('NOT_RELEASED', 'Non hai svincolato questo calciatore.');
  if (isPlayerTaken(state, playerId)) return err('PLAYER_TAKEN', 'Calciatore già assegnato.');
  if (p.budget < release.refund) {
    return err('INSUFFICIENT_CREDITS', 'Hai già speso i crediti del rimborso.');
  }
  return ok(release.refund);
}

/**
 * Taglia un calciatore: esce dalla rosa, il rimborso entra nei crediti e lo
 * `spent` scende del prezzo pagato (l'`Acquisition` viene cancellata, quindi lo
 * speso derivato dal DB fa lo stesso). Non muta lo stato.
 *
 * Non è `applyRefund`: quello restituisce **il prezzo pagato** e serve a
 * `reopenLot`, dove si annulla una vendita. Qui il rimborso è una regola di lega
 * e può valere qualunque cifra, zero compreso.
 */
export function applyRelease(
  state: AuctionState,
  participantId: string,
  playerId: number,
  refund: number,
): { participants: Participant[]; released: ReleaseEntry } {
  const owner = state.participants.find((p) => p.id === participantId);
  const entry = owner?.roster.find((r) => r.playerId === playerId);
  if (!owner || !entry) {
    throw new Error(`applyRelease: ${playerId} non è nella rosa di ${participantId}`);
  }
  const participants = state.participants.map((p) =>
    p.id !== participantId
      ? p
      : {
          ...p,
          budget: p.budget + refund,
          spent: p.spent - entry.price,
          roster: p.roster.filter((r) => r.playerId !== playerId),
        },
  );
  return {
    participants,
    released: {
      playerId,
      name: entry.name,
      team: entry.team,
      role: entry.role,
      participantId,
      teamName: owner.teamName,
      price: entry.price,
      refund,
    },
  };
}

/**
 * Inverso esatto di `applyRelease`: il calciatore torna in rosa al prezzo a cui
 * era stato comprato e il rimborso esce dai crediti. Non muta lo stato.
 */
export function applyUnrelease(
  state: AuctionState,
  release: ReleaseEntry,
): { participants: Participant[] } {
  const participants = state.participants.map((p) =>
    p.id !== release.participantId
      ? p
      : {
          ...p,
          budget: p.budget - release.refund,
          spent: p.spent + release.price,
          roster: [
            ...p.roster,
            {
              playerId: release.playerId,
              name: release.name,
              team: release.team,
              role: release.role,
              price: release.price,
            },
          ],
        },
  );
  return { participants };
}

/** L'admin può assegnare a mano? Non è vincolato al reparto, ma slot e budget sì. */
export function canAssignManual(
  state: AuctionState,
  participantId: string,
  player: Player | undefined,
  price: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (!player) return err('UNKNOWN_PLAYER', 'Calciatore sconosciuto.');
  if (isPlayerTaken(state, player.id)) return err('PLAYER_TAKEN', 'Calciatore già assegnato.');
  if (!needsRole(p, state.rules, player.role)) return err('ROLE_FULL', 'Reparto già completo.');
  if (!Number.isInteger(price) || price < 0) return err('BID_INVALID', 'Prezzo non valido.');
  if (price > p.budget) return err('INSUFFICIENT_CREDITS', 'Oltre i crediti residui.');
  return ok(price);
}

/** Chiude il lotto: ritorna `{ participants, assigned }` senza mutare lo stato. */
export function applyAssignment(state: AuctionState): {
  participants: Participant[];
  assigned: LastAssigned;
} {
  const lot = state.lot;
  if (!lot) throw new Error('applyAssignment senza lotto aperto');
  return applyPurchase(state, lot.bestParticipantId || lot.byParticipantId, lot.player, lot.price);
}

/**
 * Assegna un calciatore a un partecipante a un prezzo: usato dalla chiusura del
 * lotto, dagli svincoli e dall'assegnazione manuale. Non muta lo stato.
 */
export function applyPurchase(
  state: AuctionState,
  participantId: string,
  player: Player,
  price: number,
): { participants: Participant[]; assigned: LastAssigned } {
  const participants = state.participants.map((p) =>
    p.id !== participantId
      ? p
      : {
          ...p,
          budget: p.budget - price,
          spent: p.spent + price,
          roster: [
            ...p.roster,
            {
              playerId: player.id,
              name: player.name,
              team: player.team,
              role: player.role,
              price,
            },
          ],
        },
  );
  const winner = participants.find((p) => p.id === participantId);
  if (!winner) throw new Error(`applyPurchase: partecipante ${participantId} inesistente`);
  return {
    participants,
    assigned: {
      playerId: player.id,
      playerName: player.name,
      participantId,
      teamName: winner.teamName,
      price,
    },
  };
}

/**
 * Annulla un acquisto: il prezzo torna nei crediti, il calciatore esce dalla rosa.
 * È l'inverso esatto di `applyPurchase` e serve alla riapertura di un lotto
 * (`admin:reopenLot`): si rimborsa il compratore e si ribatte. Non muta lo stato.
 */
export function applyRefund(
  state: AuctionState,
  participantId: string,
  playerId: number,
): { participants: Participant[]; price: number } {
  const owner = state.participants.find((p) => p.id === participantId);
  const entry = owner?.roster.find((r) => r.playerId === playerId);
  if (!owner || !entry) {
    throw new Error(`applyRefund: ${playerId} non è nella rosa di ${participantId}`);
  }
  const participants = state.participants.map((p) =>
    p.id !== participantId
      ? p
      : {
          ...p,
          budget: p.budget + entry.price,
          spent: p.spent - entry.price,
          roster: p.roster.filter((r) => r.playerId !== playerId),
        },
  );
  return { participants, price: entry.price };
}

/**
 * Chi tiene in mano un lotto ne è anche il primo offerente: deve avere lo slot
 * libero e i crediti per il prezzo base. Serve a scegliere a chi torna la
 * chiamata quando l'admin riapre un lotto.
 */
export function canHoldLot(
  state: AuctionState,
  participantId: string | null | undefined,
  player: Player,
  price: number,
): boolean {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return false;
  if (!needsRole(p, state.rules, player.role)) return false;
  return computeMaxBid(p, state.rules) >= price;
}

export function isFinished(state: AuctionState): boolean {
  return (
    state.participants.length > 0 &&
    state.participants.every((p) => isRosterComplete(p, state.rules))
  );
}

/**
 * Rose incomplete ma nessun reparto ancora da battere all'asta (l'admin ne ha
 * chiusi in anticipo): è il momento degli svincoli.
 */
export function needsFilling(state: AuctionState): boolean {
  if (state.rules.callOrder !== 'fixed') return false;
  return !isFinished(state) && currentRole(state) === null;
}

/**
 * Prossimo partecipante che può effettivamente chiamare, a partire da chi è di
 * turno adesso. `null` se non ne resta nessuno.
 *
 * Con `callOrder: 'fixed'` chi ha già saturato il reparto in corso viene
 * **saltato** finché il reparto non cambia. Non c'è rischio di stallo:
 * `currentRole` ritorna il primo ruolo di cui *qualcuno* ha ancora bisogno,
 * quindi esiste sempre almeno un candidato.
 */
export function nextTurn(state: AuctionState): string | null {
  const from = state.turnOrder.indexOf(state.currentTurnParticipantId) + 1;
  return turnFrom(state, from);
}

/** Come `nextTurn` ma partendo da una posizione esplicita dell'ordine dei turni. */
export function turnFrom(state: AuctionState, fromIndex: number): string | null {
  const order = state.turnOrder;
  if (!order.length) return null;
  const role = currentRole(state); // null con callOrder 'free'
  const start = ((fromIndex % order.length) + order.length) % order.length;
  for (let k = 0; k < order.length; k += 1) {
    const id = order[(start + k) % order.length];
    const p = state.participants.find((x) => x.id === id);
    if (!p) continue;
    if (canTakeTurn(p, state.rules, role)) return id;
  }
  return null;
}

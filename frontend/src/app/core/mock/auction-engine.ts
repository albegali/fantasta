/**
 * Regole d'asta pure — port TypeScript di `mock/auction-engine.js` del prototipo.
 *
 * ⚠️ Questo file esiste **solo** per far girare il mock in-memory offline
 * (`environment.useMock`). La verità sta su `backend/src/auction/auction-engine.ts`:
 * il server è authoritative e la UI non decide nulla. Cancellabile il giorno in
 * cui il mock non serve più.
 *
 * Nessun I/O, nessuna mutazione: ogni funzione prende lo stato e ritorna un
 * verdetto o un oggetto nuovo.
 */

import {
  AuctionRules,
  AuctionState,
  ErrorCode,
  Participant,
  Player,
  ReleaseEntry,
  ReleaseRefund,
  Role,
  ROLES,
  RosterSlots,
  LastAssigned,
} from '../auction-events';

export const ROLE_LABEL: Record<Role, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

export type Verdict = { ok: true; price: number } | { ok: false; code: ErrorCode; message: string };

const err = (code: ErrorCode, message: string): Verdict => ({ ok: false, code, message });
const ok = (price: number): Verdict => ({ ok: true, price });

export function slotsUsed(participant: Participant): RosterSlots {
  const counts: RosterSlots = { P: 0, D: 0, C: 0, A: 0 };
  for (const entry of participant.roster) counts[entry.role] += 1;
  return counts;
}

export function slotsLeft(participant: Participant, rules: AuctionRules): number {
  const used = slotsUsed(participant);
  return ROLES.reduce((n, role) => n + Math.max(0, rules.rosterSlots[role] - used[role]), 0);
}

/** `maxBid = crediti residui - (slot ancora da riempire - 1)` */
export function computeMaxBid(participant: Participant, rules: AuctionRules): number {
  return Math.max(0, participant.budget - Math.max(0, slotsLeft(participant, rules) - 1));
}

export function needsRole(participant: Participant, rules: AuctionRules, role: Role): boolean {
  return slotsUsed(participant)[role] < rules.rosterSlots[role];
}

/**
 * Con `callOrder: 'fixed'` si compra un reparto alla volta: P → D → C → A.
 * Salta i reparti che l'admin ha chiuso in anticipo: quelli non tornano all'asta,
 * i loro slot vuoti si riempiono negli svincoli finali.
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

export function startPriceFor(rules: AuctionRules, player: Player, requested?: number): number {
  const base = rules.startPriceMode === 'quotation' ? player.quotation : rules.startPrice;
  return Math.max(1, requested ?? base);
}

export function isPlayerTaken(state: AuctionState, playerId: number): boolean {
  return state.participants.some((p) => p.roster.some((r) => r.playerId === playerId));
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
  if (state.status === 'RELEASING') {
    return err('NOT_IDLE', 'Finestra di svincolo aperta: l’asta non è ancora ripartita.');
  }
  if (state.lot) return err('LOT_OPEN', 'C’è già un’asta in corso.');
  if (state.currentTurnParticipantId !== participantId)
    return err('NOT_YOUR_TURN', 'Non è il tuo turno.');
  if (!player) return err('UNKNOWN_PLAYER', 'Calciatore sconosciuto.');
  if (isPlayerTaken(state, player.id)) return err('PLAYER_TAKEN', 'Calciatore già assegnato.');
  if (!needsRole(p, state.rules, player.role)) return err('ROLE_FULL', 'Reparto già completo.');
  const role = currentRole(state);
  if (role && player.role !== role) {
    return err('ROLE_LOCKED', `Si sta completando il reparto ${ROLE_LABEL[role]}.`);
  }
  const price = startPriceFor(state.rules, player, requestedPrice);
  if (price > computeMaxBid(p, state.rules))
    return err('INSUFFICIENT_CREDITS', 'Crediti insufficienti.');
  return ok(price);
}

export function validateBid(
  state: AuctionState,
  participantId: string | null,
  price: number,
): Verdict {
  const p = state.participants.find((x) => x.id === participantId);
  if (!p) return err('UNKNOWN_PARTICIPANT', 'Partecipante sconosciuto.');
  if (!state.lot || state.status !== 'BIDDING') return err('NOT_BIDDING', 'Nessuna asta aperta.');
  if (state.lot.bestParticipantId === participantId)
    return err('ALREADY_BEST', 'Sei già il miglior offerente.');
  if (!Number.isInteger(price)) return err('BID_INVALID', 'Offerta non valida.');
  if (price <= state.lot.price) return err('BID_TOO_LOW', 'Offerta troppo bassa.');
  if (!needsRole(p, state.rules, state.lot.player.role))
    return err('ROLE_FULL', 'Reparto già completo.');
  if (price > computeMaxBid(p, state.rules))
    return err('INSUFFICIENT_CREDITS', 'Oltre il tuo massimo.');
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

/** Chiude il lotto: ritorna `{ participants, assigned }` senza mutare lo stato. */
export function applyAssignment(state: AuctionState): {
  participants: Participant[];
  assigned: LastAssigned;
} {
  const lot = state.lot;
  if (!lot) throw new Error('applyAssignment senza lotto aperto');
  const winnerId = lot.bestParticipantId || lot.byParticipantId;
  const participants = state.participants.map((p) =>
    p.id !== winnerId
      ? p
      : {
          ...p,
          budget: p.budget - lot.price,
          spent: p.spent + lot.price,
          roster: [
            ...p.roster,
            {
              playerId: lot.player.id,
              name: lot.player.name,
              team: lot.player.team,
              role: lot.player.role,
              price: lot.price,
            },
          ],
        },
  );
  const winner = participants.find((p) => p.id === winnerId)!;
  return {
    participants,
    assigned: {
      playerId: lot.player.id,
      playerName: lot.player.name,
      participantId: winnerId,
      teamName: winner.teamName,
      price: lot.price,
    },
  };
}

/**
 * Assegna uno svincolo: come `applyAssignment` ma senza lotto né asta, a prezzo
 * fisso. Non muta lo stato.
 */
export function applyClaim(
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
  const winner = participants.find((p) => p.id === participantId)!;
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
 * Inverso di `applyClaim`/`applyAssignment`, usato dalla riapertura di un lotto.
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

/* ── mercato di riparazione ── */

/** Crediti restituiti da uno svincolo, secondo la regola di lega. */
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
 * Si può tagliare? Solo dalla propria rosa, a finestra aperta, e solo se dopo il
 * taglio resta 1 credito per ogni slot vuoto — altrimenti la rosa non sarebbe più
 * completabile nemmeno agli svincoli e l'asta si pianterebbe.
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

/** Taglia: fuori dalla rosa, rimborso nei crediti, `spent` giù del prezzo pagato. */
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

/** Inverso esatto di `applyRelease`. */
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

/** Chi tiene in mano un lotto ne è il primo offerente: slot libero e crediti. */
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
  return state.participants.every((p) => slotsLeft(p, state.rules) === 0);
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
 * Prossimo partecipante che può effettivamente chiamare.
 *
 * Con `callOrder: 'fixed'` si compra **un reparto alla volta per tutta la lega**:
 * chi ha già saturato il reparto in corso viene **saltato** finché il reparto non
 * cambia (cioè finché resta almeno un altro partecipante che ha bisogno di quel
 * ruolo — vedi `currentRole`). Non c'è rischio di stallo: `currentRole` ritorna
 * il primo ruolo di cui *qualcuno* ha ancora bisogno, quindi esiste sempre almeno
 * un candidato.
 */
export function nextTurn(state: AuctionState): string | null {
  const order = state.turnOrder;
  const role = currentRole(state); // null con callOrder 'free'
  const i = order.indexOf(state.currentTurnParticipantId);
  for (let k = 1; k <= order.length; k += 1) {
    const id = order[(i + k) % order.length];
    const p = state.participants.find((x) => x.id === id);
    if (!p) continue;
    if (slotsLeft(p, state.rules) === 0) continue; // rosa completa
    if (role && !needsRole(p, state.rules, role)) continue; // reparto in corso già saturo
    return id;
  }
  return null;
}

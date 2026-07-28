import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Participant } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { Avatar } from '../../shared/avatar';
import { RoleCounters } from '../../shared/role-counters';

const LOW_CREDITS = 40;

interface LeagueCard {
  participant: Participant;
  last: string;
  low: boolean;
  mine: boolean;
}

/** Tutte le squadre della lega: crediti, reparti, ultimo acquisto. */
@Component({
  selector: 'app-league-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RoleCounters],
  templateUrl: './league-page.html',
})
export class LeaguePage {
  private readonly store = inject(AuctionStore);

  protected readonly cards = computed<LeagueCard[]>(() => {
    const myId = this.store.me()?.id;
    return this.store.participants().map((participant) => {
      const last = participant.roster.at(-1);
      return {
        participant,
        last: last ? `Ultimo acquisto: ${last.name} · ${last.price}` : 'Nessun acquisto',
        low: participant.budget < LOW_CREDITS,
        mine: !!myId && participant.id === myId,
      };
    });
  });
}

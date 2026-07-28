import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AuctionStore } from '../../core/auction.store';
import { Avatar } from '../../shared/avatar';
import { RoleCounters } from '../../shared/role-counters';

/** Di chi è il turno di chiamata, con i contatori di reparto. */
@Component({
  selector: 'app-turn-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RoleCounters],
  template: `
    @let turn = participant();
    @if (turn) {
      <div class="panel-md row" style="padding: 10px 12px; border-radius: 10px">
        <app-avatar [name]="turn.name" [color]="turn.color" [size]="38" />
        <div class="grow">
          <div class="kicker kicker-accent">{{ kicker() }}</div>
          <div class="ellipsis" style="font-size: 15px; font-weight: 500">{{ line() }}</div>
        </div>
        <div style="display: flex; gap: 4px">
          <app-role-counters [participant]="turn" />
        </div>
      </div>
    }
  `,
})
export class TurnBanner {
  private readonly store = inject(AuctionStore);

  protected readonly participant = this.store.turnParticipant;

  protected readonly kicker = computed(() =>
    this.store.isMyTurn() ? 'Turno di chiamata · tu' : 'Turno di chiamata',
  );

  protected readonly line = computed(() => {
    const turn = this.participant();
    if (!turn) return '';
    if (this.store.isMyTurn()) return this.store.me()?.teamName ?? turn.teamName;
    return `${turn.name} · ${turn.teamName}`;
  });
}

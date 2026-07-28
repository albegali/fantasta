import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { Participant, Role, ROLES } from '../core/auction-events';
import { AuctionStore } from '../core/auction.store';

interface Cell {
  role: Role;
  text: string;
  full: boolean;
}

/**
 * Pill compatte `P 1 / D 3 / C 2 / A 0` — compaiono dovunque appaia una squadra
 * (frontend-handoff.md §6). In modalità `big` mostrano `usati/totali`.
 */
@Component({
  selector: 'app-role-counters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (cell of cells(); track cell.role) {
      @if (big()) {
        <div class="counter counter-big" [class.is-full]="cell.full">
          <div class="kicker">{{ cell.role }}</div>
          <div class="num" style="font-weight:600;font-size:18px;margin-top:2px">
            {{ cell.text }}
          </div>
        </div>
      } @else {
        <div class="counter" [class.is-full]="cell.full">{{ cell.text }}</div>
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class RoleCounters {
  private readonly store = inject(AuctionStore);

  readonly participant = input.required<Participant>();
  readonly big = input(false);

  protected readonly cells = computed<Cell[]>(() => {
    const slots = this.store.rules()?.rosterSlots;
    if (!slots) return [];
    const used = this.store.slotsUsed(this.participant());
    return ROLES.map((role) => ({
      role,
      text: this.big() ? `${used[role]}/${slots[role]}` : `${role} ${used[role]}`,
      full: used[role] >= slots[role],
    }));
  });
}

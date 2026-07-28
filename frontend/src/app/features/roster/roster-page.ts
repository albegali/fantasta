import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuctionStore } from '../../core/auction.store';
import { RoleChip } from '../../shared/role-chip';
import { RoleCounters } from '../../shared/role-counters';

/** La mia rosa: budget speso, contatori di reparto, calciatori acquistati. */
@Component({
  selector: 'app-roster-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleChip, RoleCounters],
  templateUrl: './roster-page.html',
})
export class RosterPage {
  private readonly store = inject(AuctionStore);
  private readonly router = inject(Router);

  protected readonly me = this.store.me;
  protected readonly budget = computed(() => this.store.rules()?.budget ?? 0);

  protected readonly spentPct = computed(() => {
    const me = this.me();
    const budget = this.budget();
    return me && budget ? `${Math.round((me.spent / budget) * 100)}%` : '0%';
  });

  protected readonly advice = computed(() => {
    const me = this.me();
    if (!me) return '';
    return `Restano ${this.store.slotsLeft(me)} slot e ${me.budget} crediti. Massimo per un singolo colpo: ${this.store.maxBidOf(me)}.`;
  });

  protected async leave(): Promise<void> {
    this.store.leave();
    await this.router.navigate(['/']);
  }
}

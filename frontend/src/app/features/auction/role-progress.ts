import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Role, ROLES } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ROLE_LABEL_PLURAL } from '../../shared/ui';

interface RoleStep {
  role: Role;
  label: string;
  /** Reparto completato da tutta la lega. */
  done: boolean;
  /** Chiuso dall'admin con slot ancora vuoti: quelli vanno agli svincoli. */
  closed: boolean;
  current: boolean;
  filled: number;
  total: number;
}

/**
 * Quale reparto sta comprando la lega, e quanto manca a chiuderlo.
 * Visibile solo con `callOrder: 'fixed'`: con l'ordine libero non esiste un
 * reparto "in corso".
 */
@Component({
  selector: 'app-role-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './role-progress.html',
})
export class RoleProgress {
  private readonly store = inject(AuctionStore);

  protected readonly visible = this.store.isFixedOrder;
  protected readonly currentRole = this.store.currentRole;
  protected readonly amISkipped = this.store.amISkipped;
  protected readonly isFilling = this.store.isFilling;

  protected readonly steps = computed<RoleStep[]>(() => {
    const rules = this.store.rules();
    const participants = this.store.participants();
    if (!rules || !participants.length) return [];
    const current = this.currentRole();
    const closed = this.store.closedRoles();

    return ROLES.map((role) => {
      const total = rules.rosterSlots[role] * participants.length;
      const filled = participants.reduce((n, p) => n + this.store.slotsUsed(p)[role], 0);
      return {
        role,
        label: ROLE_LABEL_PLURAL[role],
        done: filled >= total,
        closed: closed.includes(role) && filled < total,
        current: role === current,
        filled,
        total,
      };
    });
  });

  protected readonly currentStep = computed(() => this.steps().find((s) => s.current) ?? null);

  /** Slot lasciati indietro dai reparti chiusi in anticipo: finiranno negli svincoli. */
  protected readonly leftoverSlots = computed(() =>
    this.steps()
      .filter((s) => s.closed)
      .reduce((n, s) => n + (s.total - s.filled), 0),
  );

  protected readonly pct = computed(() => {
    const step = this.currentStep();
    return step && step.total ? `${Math.round((step.filled / step.total) * 100)}%` : '0%';
  });
}

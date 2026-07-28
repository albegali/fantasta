import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { AlertsService } from '../../core/alerts.service';
import { AuctionStore } from '../../core/auction.store';
import { Avatar } from '../../shared/avatar';
import { RoleChip } from '../../shared/role-chip';
import { digitsOnly } from '../../shared/ui';

/** Sotto i 3 secondi il timer cambia colore e passa al decimale. */
const URGENT_SECONDS = 3;
const QUICK_STEPS = [1, 5, 10] as const;

interface QuickBid {
  step: number;
  label: string;
  disabled: boolean;
}

/**
 * Il lotto aperto: anello del countdown, offerta più alta, controlli di rilancio.
 *
 * È **l'unico** componente che legge `remainingMs`: isolarlo evita di
 * ridisegnare la lista partecipanti quattro volte al secondo
 * (frontend-handoff.md §5).
 */
@Component({
  selector: 'app-lot-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RoleChip],
  templateUrl: './lot-card.html',
})
export class LotCard {
  private readonly store = inject(AuctionStore);
  protected readonly alerts = inject(AlertsService);

  protected readonly lot = this.store.lot;
  protected readonly amIBest = this.store.amIBest;
  protected readonly myMaxBid = this.store.myMaxBid;

  protected readonly custom = signal('');

  protected readonly caller = computed(() => this.store.byId(this.lot()?.byParticipantId ?? null));
  protected readonly leader = computed(() =>
    this.store.byId(this.lot()?.bestParticipantId ?? null),
  );

  protected readonly seconds = this.store.remainingSeconds;
  protected readonly urgent = computed(() => this.seconds() < URGENT_SECONDS);

  protected readonly timerText = computed(() =>
    this.urgent() ? this.seconds().toFixed(1) : String(Math.ceil(this.seconds())),
  );

  protected readonly ringPct = computed(() => {
    const total = this.store.rules()?.bidTimerSeconds ?? 1;
    return `${Math.max(0, Math.min(100, (this.seconds() / total) * 100))}%`;
  });

  protected readonly quickBids = computed<QuickBid[]>(() => {
    const price = this.lot()?.price ?? 0;
    const best = this.amIBest();
    const max = this.myMaxBid();
    return QUICK_STEPS.map((step) => ({
      step,
      label: `+${step}`,
      disabled: best || price + step > max,
    }));
  });

  protected readonly customValue = computed(() => Number.parseInt(this.custom(), 10));
  protected readonly customDisabled = computed(
    () => this.amIBest() || !this.custom() || Number.isNaN(this.customValue()),
  );

  /** Riga di stato sotto i bottoni: l'errore del server ha la precedenza. */
  protected readonly maxLine = computed(() => {
    const error = this.store.error();
    if (error) return error;
    if (this.amIBest()) return 'Sei tu il più alto. Respira.';
    return `Puoi arrivare a ${this.myMaxBid()} e restare in regola`;
  });

  protected quickBid(step: number): void {
    const price = this.lot()?.price ?? 0;
    if (step === 1) this.store.bidPlus1();
    else this.store.bidAmount(price + step);
  }

  protected onCustom(value: string): void {
    this.custom.set(digitsOnly(value));
  }

  protected customBid(): void {
    if (this.customDisabled()) return;
    this.store.bidAmount(this.customValue());
    this.custom.set('');
  }
}

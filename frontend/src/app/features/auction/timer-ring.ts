import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AuctionStore } from '../../core/auction.store';

/** Sotto i 3 secondi l'anello passa al rosso e il numero al decimale. */
const URGENT_SECONDS = 3;

/**
 * L'anello del countdown, in un componente suo **per una ragione di
 * prestazioni**: è l'unico posto che legge `remainingSeconds`, che cambia ~4
 * volte al secondo. Se stesse dentro `LotCard`, ogni tick invaliderebbe anche
 * i bottoni di rilancio, l'offerta e il nome del calciatore.
 *
 * `LotCard` legge solo `urgent()`, che è un booleano: un `computed` non propaga
 * se il valore non cambia, quindi la card si ridisegna una volta sola — quando
 * si passa la soglia dei 3 secondi — e non quaranta.
 *
 * Il tempo resta del server (`lot.endsAt`): qui si disegna, non si decide.
 */
@Component({
  selector: 'app-timer-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ring"
      role="timer"
      aria-live="off"
      [style.--ring-pct]="pct()"
      [style.--ring-color]="urgent() ? 'var(--color-urgent)' : 'var(--color-accent)'"
    >
      <div class="ring-core">
        <span class="ring-num" [class.is-urgent]="urgent()">{{ text() }}</span>
      </div>
    </div>
  `,
})
export class TimerRing {
  private readonly store = inject(AuctionStore);

  private readonly seconds = this.store.remainingSeconds;

  protected readonly urgent = computed(() => this.seconds() < URGENT_SECONDS);

  /** Negli ultimi secondi il decimale: fa capire che il tempo sta scadendo. */
  protected readonly text = computed(() =>
    this.urgent() ? this.seconds().toFixed(1) : String(Math.ceil(this.seconds())),
  );

  protected readonly pct = computed(() => {
    const total = this.store.rules()?.bidTimerSeconds ?? 1;
    return `${Math.max(0, Math.min(100, (this.seconds() / total) * 100))}%`;
  });
}

import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';

import { AlertsService } from '../../core/alerts.service';
import { AuctionStore } from '../../core/auction.store';
import { BidFeed } from './bid-feed';
import { FillingPanel } from './filling-panel';
import { LotCard } from './lot-card';
import { NominateSearch } from './nominate-search';
import { PresenceList } from './presence-list';
import { ReleasePanel } from './release-panel';
import { RoleProgress } from './role-progress';
import { TurnBanner } from './turn-banner';

/**
 * La sala d'asta. Unica schermata "calda": il countdown vive dentro `LotCard`,
 * così presenze e feed non si ridisegnano a ogni tick (frontend-handoff.md §5).
 */
@Component({
  selector: 'app-auction-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TurnBanner,
    RoleProgress,
    NominateSearch,
    LotCard,
    BidFeed,
    PresenceList,
    FillingPanel,
    ReleasePanel,
  ],
  templateUrl: './auction-page.html',
})
export class AuctionPage {
  private readonly store = inject(AuctionStore);
  private readonly alerts = inject(AlertsService);

  protected readonly status = this.store.status;
  protected readonly lastAssigned = computed(() => this.store.state()?.lastAssigned ?? null);
  protected readonly quip = this.store.quip;
  /** Reparto in corso saturo per me: il server mi salta finché non cambia. */
  protected readonly amISkipped = this.store.amISkipped;

  /** Tocca a me chiamare: pannello di ricerca. */
  protected readonly idleMine = computed(() => this.status() === 'IDLE' && this.store.isMyTurn());
  /** Tocca a un altro (o l'admin ha messo in pausa): schermata d'attesa. */
  protected readonly idleTheirs = computed(
    () => (this.status() === 'IDLE' && !this.store.isMyTurn()) || this.status() === 'PAUSED',
  );
  protected readonly isRunning = computed(() => this.status() === 'BIDDING' && !!this.store.lot());
  /** Svincoli finali: rose da chiudere a prezzo fisso, senza asta. */
  protected readonly isFilling = this.store.isFilling;
  /** Finestra di svincolo del mercato di riparazione: ognuno taglia dalla sua rosa. */
  protected readonly isReleasing = this.store.isReleasing;
  protected readonly isSold = computed(() => this.status() === 'ASSIGNED' && !!this.lastAssigned());
  protected readonly isFinished = computed(() => this.status() === 'FINISHED');
  /** Senza turni il banner non ha senso: svincoli, riparazione, fine asta. */
  protected readonly showTurnBanner = computed(
    () => !this.isFilling() && !this.isReleasing() && !this.isFinished(),
  );

  protected readonly thinkingLine = computed(() =>
    this.status() === 'PAUSED'
      ? 'Asta in pausa'
      : `${this.store.turnParticipant()?.name ?? 'Qualcuno'} sta scegliendo…`,
  );

  constructor() {
    // Suono/vibrazione: un bip a ogni nuovo prezzo, uno diverso quando tocca a me.
    let lastPrice = -1;
    effect(() => {
      const price = this.store.lot()?.price ?? -1;
      if (price !== lastPrice && lastPrice >= 0 && price >= 0) this.alerts.bid();
      lastPrice = price;
    });

    let wasMyTurn = false;
    effect(() => {
      const mine = this.idleMine();
      if (mine && !wasMyTurn) this.alerts.yourTurn();
      wasMyTurn = mine;
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FILLING_PRICE, PlayerRow, Role, ROLES } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort } from '../../core/ports';
import { RoleChip } from '../../shared/role-chip';
import { ROLE_LABEL_PLURAL } from '../../shared/ui';

/** Quanti rimasti mostrare per reparto scoperto. */
const PER_ROLE = 40;

interface RoleBucket {
  role: Role;
  label: string;
  missing: number;
  players: PlayerRow[];
}

/**
 * Svincoli finali: le rose incomplete si chiudono a prezzo fisso, senza asta e
 * senza turni. Chi clicca prima si prende il calciatore — il server serializza,
 * quindi il secondo riceve `PLAYER_TAKEN`.
 *
 * Mostra un blocco per ogni reparto in cui **io** ho ancora slot vuoti.
 */
@Component({
  selector: 'app-filling-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleChip],
  templateUrl: './filling-panel.html',
})
export class FillingPanel {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);

  protected readonly price = FILLING_PRICE;
  protected readonly me = this.store.me;
  protected readonly slotsLeft = this.store.mySlotsLeft;
  protected readonly loading = signal(true);

  private readonly available = signal<PlayerRow[]>([]);

  /** I reparti che devo ancora chiudere, con i rimasti fra cui pescare. */
  protected readonly buckets = computed<RoleBucket[]>(() => {
    const me = this.me();
    const rules = this.store.rules();
    if (!me || !rules) return [];
    const used = this.store.slotsUsed(me);
    return ROLES.filter((role) => used[role] < rules.rosterSlots[role]).map((role) => ({
      role,
      label: ROLE_LABEL_PLURAL[role],
      missing: rules.rosterSlots[role] - used[role],
      players: this.available().filter((p) => p.role === role),
    }));
  });

  protected readonly canAfford = computed(() => (this.me()?.budget ?? 0) >= FILLING_PRICE);

  constructor() {
    // Ogni assegnazione (mia o di un altro) cambia la lista dei rimasti.
    effect(() => {
      this.store.participants();
      void this.reload();
    });

    inject(DestroyRef).onDestroy(() => this.available.set([]));
  }

  private async reload(): Promise<void> {
    const rows = await this.api.listPlayers({ available: true, take: PER_ROLE * ROLES.length });
    this.available.set(rows);
    this.loading.set(false);
  }

  protected claim(player: PlayerRow): void {
    this.store.claim(player.id);
  }
}

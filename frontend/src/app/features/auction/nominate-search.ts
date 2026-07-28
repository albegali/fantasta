import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { PlayerRow } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort } from '../../core/ports';
import { RoleChip } from '../../shared/role-chip';
import { ROLE_LABEL, ROLE_LABEL_PLURAL } from '../../shared/ui';

const DEBOUNCE_MS = 120;
/** Quanti calciatori mostrare a campo vuoto: i più quotati del reparto. */
const TOP_COUNT = 20;
/** Risultati di una ricerca per nome: la lista deve restare leggibile. */
const SEARCH_COUNT = 10;

interface ResultRow {
  player: PlayerRow;
  callable: boolean;
  /** Motivo del blocco, mostrato al posto della quotazione. */
  blocked: string | null;
}

/**
 * Ricerca e chiamata. A campo vuoto (click o focus) mostra i venti calciatori
 * **più quotati** ancora disponibili; digitando parte l'autocomplete, che include
 * anche i già assegnati — così si capisce *perché* un nome non si può chiamare.
 *
 * Con `callOrder: 'fixed'` la lista è filtrata dal server sul reparto in corso:
 * i ruoli fuori reparto non compaiono affatto.
 */
@Component({
  selector: 'app-nominate-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleChip],
  templateUrl: './nominate-search.html',
})
export class NominateSearch {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  private readonly rows = signal<PlayerRow[]>([]);

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Scarta le risposte arrivate fuori ordine (l'ultima richiesta vince). */
  private requestSeq = 0;

  protected readonly currentRole = this.store.currentRole;

  protected readonly roleHint = computed(() => {
    const role = this.currentRole();
    return role ? ROLE_LABEL_PLURAL[role] : null;
  });

  protected readonly roleHintSingular = computed(() => {
    const role = this.currentRole();
    return role ? ROLE_LABEL[role] : null;
  });

  protected readonly placeholder = computed(() => {
    const role = this.roleHint();
    return role ? `Cerca fra i ${role.toLowerCase()}…` : 'Cerca: cognome, squadra…';
  });

  protected readonly listLabel = computed(() => {
    if (this.query().trim()) return 'Risultati';
    const role = this.roleHint();
    return role ? `I ${role.toLowerCase()} più quotati` : 'I più quotati disponibili';
  });

  protected readonly results = computed<ResultRow[]>(() => {
    const me = this.store.me();
    const rules = this.store.rules();
    if (!me || !rules) return [];
    const maxBid = this.store.myMaxBid();

    return this.rows().map((player) => {
      const price = rules.startPriceMode === 'quotation' ? player.quotation : rules.startPrice;
      let blocked: string | null = null;
      if (player.taken) blocked = 'Già preso';
      else if (!this.store.needsRole(me, player.role)) blocked = 'Reparto pieno';
      else if (price > maxBid) blocked = 'Fuori budget';
      return { player, callable: !blocked, blocked };
    });
  });

  protected readonly noResults = computed(
    () => !this.loading() && this.query().trim().length > 1 && this.rows().length === 0,
  );

  constructor() {
    // Cambia il reparto in corso: la lista mostrata non è più valida.
    effect(() => {
      this.currentRole();
      if (untracked(this.open)) void this.fetch();
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  /** Click o focus sul campo: apre la tendina con i più quotati. */
  protected focus(): void {
    if (this.open()) return;
    this.open.set(true);
    void this.fetch();
  }

  protected search(value: string): void {
    this.query.set(value);
    this.open.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fetch(), DEBOUNCE_MS);
  }

  private async fetch(): Promise<void> {
    const seq = ++this.requestSeq;
    const q = this.query().trim();
    this.loading.set(true);
    const rows = await this.api.listPlayers({
      q,
      role: this.currentRole(),
      // A campo vuoto è una lista "cosa posso comprare": i presi sono rumore.
      // Cercando per nome invece si mostrano, per spiegare l'assenza.
      available: !q,
      take: q ? SEARCH_COUNT : TOP_COUNT,
    });
    if (seq !== this.requestSeq) return; // sorpassata da una richiesta più recente
    this.rows.set(rows);
    this.loading.set(false);
  }

  protected call(row: ResultRow): void {
    if (!row.callable) return;
    this.store.nominate(row.player.id);
    this.reset();
  }

  protected clear(): void {
    this.query.set('');
    void this.fetch();
  }

  private reset(): void {
    this.query.set('');
    this.rows.set([]);
    this.open.set(false);
  }
}

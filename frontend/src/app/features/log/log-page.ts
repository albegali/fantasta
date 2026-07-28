import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { AuctionLogEntry, AuctionLogType } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort } from '../../core/ports';
import { RoleChip } from '../../shared/role-chip';
import { LogLine, toLogLine } from './log-line';

type FilterId = 'all' | 'purchases' | 'bids';

interface FilterTab {
  id: FilterId;
  label: string;
}

const FILTERS: readonly FilterTab[] = [
  { id: 'all', label: 'Tutto' },
  { id: 'purchases', label: 'Acquisti' },
  { id: 'bids', label: 'Rilanci' },
] as const;

const TYPES: Record<FilterId, AuctionLogType[] | undefined> = {
  all: undefined,
  purchases: ['assigned', 'claim', 'manual'],
  bids: ['nominate', 'bid'],
};

/** Righe per pagina: una serata d'asta ne produce qualche migliaio. */
const PAGE = 100;

/**
 * Telecronaca: chi ha chiamato, chi ha rilanciato, chi ha comprato cosa e a quanto.
 *
 * Legge da **due** sorgenti e le fonde per `seq`:
 * - `state.log`, la coda recente che arriva con ogni snapshot → la pagina si
 *   aggiorna da sola mentre l'asta va avanti, senza polling;
 * - `GET /log` (`api.getLog`), per la storia vera e per le pagine più vecchie.
 *
 * Il `seq` è progressivo e assegnato dal server, quindi la fusione è una
 * deduplicazione: nessun rischio di righe doppie o fuori ordine.
 *
 * Le righe in diretta si **accumulano** (`live`) invece di essere lette dalla coda
 * volta per volta: la coda tiene solo `LOG_TAIL` righe e una sala infuocata la fa
 * ruotare in fretta, lasciando buchi in mezzo alla cronaca. Ogni riga fa scattare
 * uno snapshot, quindi accumulando non se ne perde nessuna.
 */
@Component({
  selector: 'app-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleChip],
  templateUrl: './log-page.html',
})
export class LogPage {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);

  protected readonly filters = FILTERS;

  protected readonly filter = signal<FilterId>('all');
  /** `''` = tutta la lega. */
  protected readonly team = signal('');
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  /** Storia arrivata dal REST, la più recente in testa. */
  private readonly loaded = signal<AuctionLogEntry[]>([]);
  /** Righe viste in diretta da quando la pagina è aperta, la più recente in testa. */
  private readonly live = signal<AuctionLogEntry[]>([]);
  /** L'ultima pagina era piena: probabile che ce ne sia un'altra. */
  private readonly more = signal(false);

  protected readonly auctionName = computed(() => this.store.rules()?.auctionName ?? 'Asta');
  protected readonly participants = this.store.participants;
  protected readonly myId = computed(() => this.store.me()?.id ?? null);
  protected readonly canLoadMore = computed(() => this.more() && !this.loading());

  protected readonly lines = computed<LogLine[]>(() => {
    const fromRoom = this.live().filter((e) => this.matches(e));
    const seen = new Set<number>();
    const merged: AuctionLogEntry[] = [];
    for (const entry of [...fromRoom, ...this.loaded()]) {
      if (seen.has(entry.seq)) continue;
      seen.add(entry.seq);
      merged.push(entry);
    }
    return merged.sort((a, b) => b.seq - a.seq).map(toLogLine);
  });

  constructor() {
    // La coda dello snapshot entra nel pool; `untracked` perché qui si scrive,
    // e l'unica dipendenza da seguire è lo stato.
    effect(() => {
      const tail = this.store.state()?.log ?? [];
      untracked(() => this.absorb(tail));
    });
    void this.reload();
  }

  protected setFilter(id: FilterId): void {
    if (this.filter() === id) return;
    this.filter.set(id);
    void this.reload();
  }

  protected setTeam(participantId: string): void {
    if (this.team() === participantId) return;
    this.team.set(participantId);
    void this.reload();
  }

  /** Ricarica la prima pagina: si usa al cambio di filtro e all'ingresso. */
  protected async reload(): Promise<void> {
    this.loaded.set([]);
    await this.fetch(undefined);
  }

  /**
   * Assorbe la coda dello snapshot nel pool della diretta. Se la numerazione è
   * **tornata indietro** l'admin ha azzerato l'asta: la cronaca vecchia non
   * racconta più niente, si butta il pool e si ricarica.
   */
  private absorb(tail: AuctionLogEntry[]): void {
    // Coda vuota = niente da dire (lega nuova, o lo snapshot REST pre-auth che non
    // porta cronaca): non è un azzeramento.
    if (!tail.length) return;
    const pool = this.live();
    const known = pool[0]?.seq ?? 0;
    const newest = tail[0].seq;
    if (newest < known) {
      this.live.set([...tail]);
      void this.reload();
      return;
    }
    const seen = new Set(pool.map((e) => e.seq));
    const fresh = tail.filter((e) => !seen.has(e.seq));
    if (fresh.length) this.live.set([...fresh, ...pool]);
  }

  protected loadMore(): Promise<void> {
    const oldest = this.loaded().at(-1)?.seq;
    return this.fetch(oldest);
  }

  private async fetch(before: number | undefined): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.getLog({
        take: PAGE,
        before,
        types: TYPES[this.filter()],
        participantId: this.team() || undefined,
      });
      this.loaded.update((rows) => (before === undefined ? page : [...rows, ...page]));
      this.more.set(page.length === PAGE);
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Le righe che arrivano in diretta devono passare lo **stesso** filtro di quelle
   * chieste al server, altrimenti l'ultimo rilancio comparirebbe anche nella vista
   * "Acquisti".
   */
  private matches(entry: AuctionLogEntry): boolean {
    const types = TYPES[this.filter()];
    if (types && !types.includes(entry.type)) return false;
    const team = this.team();
    return !team || entry.participantId === team;
  }
}

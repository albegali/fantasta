import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { BidType } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { toLogLine } from '../log/log-line';
import { Avatar } from '../../shared/avatar';

interface FeedRow {
  id: string;
  name: string;
  color: string | null | undefined;
  text: string;
  amount: number | null;
  mine: boolean;
  type: BidType;
}

/** Quante righe di cronaca mostrare fra un lotto e l'altro. */
const RECENT = 8;

/**
 * Rilanci in diretta: `lot.history`, il più recente in testa.
 *
 * Fra un lotto e l'altro — turno da assegnare, pausa, svincoli — il lotto non
 * c'è e il pannello resterebbe muto: allora racconta la **coda della telecronaca**
 * (`state.log`), così la sala continua a vedere chi ha comprato cosa. La frase la
 * compone `features/log/log-line.ts`, la stessa della pagina Storia.
 */
@Component({
  selector: 'app-bid-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar],
  template: `
    <div class="panel-md" style="overflow: hidden">
      <div class="row" style="padding: 11px 13px">
        <span class="live-dot" style="animation-duration: 1.4s"></span>
        <span class="kicker">{{ live() ? 'Rilanci in diretta' : 'Telecronaca' }}</span>
      </div>
      <div
        class="scroll-y"
        style="max-height: 300px; padding: 0 13px 13px; display: flex; flex-direction: column; gap: 6px"
      >
        @for (row of rows(); track row.id) {
          <div class="feed-row" [class.is-mine]="row.mine">
            <app-avatar [name]="row.name" [color]="row.color" [size]="24" />
            <span class="grow ellipsis" style="font-size: 13px">{{ row.text }}</span>
            @if (row.amount !== null) {
              <span class="feed-amount" [class.is-nominate]="row.type === 'nominate'">{{
                row.amount
              }}</span>
            }
          </div>
        } @empty {
          <div
            style="padding: 16px 4px; font-size: 13px; color: color-mix(in srgb, var(--color-text) 40%, transparent)"
          >
            Silenzio in sala. Per ora.
          </div>
        }
      </div>
    </div>
  `,
})
export class BidFeed {
  private readonly store = inject(AuctionStore);

  protected readonly live = computed(() => !!this.store.lot());

  protected readonly rows = computed<FeedRow[]>(() =>
    this.store.lot() ? this.lotRows() : this.recentRows(),
  );

  /** Il lotto aperto: un rilancio per riga, com'è sempre stato. */
  private lotRows(): FeedRow[] {
    const lot = this.store.lot()!;
    const myId = this.store.me()?.id;
    return lot.history.map((entry, i) => {
      const who = this.store.byId(entry.participantId);
      return {
        id: `${entry.at}-${i}`,
        name: who?.name ?? '?',
        color: who?.color,
        text:
          entry.type === 'nominate'
            ? `${who?.name} chiama ${lot.player.name}`
            : `${who?.name} rilancia`,
        amount: entry.price,
        mine: !!myId && entry.participantId === myId,
        type: entry.type,
      };
    });
  }

  /**
   * Nessun lotto: le ultime righe di cronaca. Il nome per l'avatar lo prende dal
   * partecipante se c'è ancora, altrimenti resta quello scritto nel log.
   */
  private recentRows(): FeedRow[] {
    const myId = this.store.me()?.id;
    return (this.store.state()?.log ?? []).slice(0, RECENT).map((entry) => {
      const line = toLogLine(entry);
      const who = this.store.byId(entry.participantId);
      return {
        id: `log-${line.seq}`,
        name: who?.name ?? line.teamName ?? '·',
        color: who?.color,
        text: line.note ? `${line.text} · ${line.note}` : line.text,
        amount: line.amount,
        mine: !!myId && entry.participantId === myId,
        type: line.kind === 'purchase' ? 'bid' : 'nominate',
      };
    });
  }
}

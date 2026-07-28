import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Participant } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { Avatar } from '../../shared/avatar';

/** Sotto questa soglia i crediti residui passano all'accento: stai finendo. */
const LOW_CREDITS = 40;

interface PresenceRow {
  participant: Participant;
  sub: string;
  low: boolean;
}

/** Chi è in sala, con crediti residui e chi deve chiamare adesso. */
@Component({
  selector: 'app-presence-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar],
  template: `
    <div class="panel-md" style="overflow: hidden">
      <div class="kicker" style="padding: 11px 13px">
        In sala · {{ onlineCount() }}/{{ rows().length }}
      </div>
      <div style="padding: 0 13px 13px; display: flex; flex-direction: column; gap: 2px">
        @for (row of rows(); track row.participant.id) {
          <div
            class="row"
            style="gap: 9px; padding: 6px 4px"
            [style.opacity]="row.participant.online ? 1 : 0.45"
          >
            <app-avatar
              [name]="row.participant.name"
              [color]="row.participant.color"
              [size]="28"
              [online]="row.participant.online"
            />
            <span class="grow">
              <span class="ellipsis" style="display: block; font-weight: 500; font-size: 13px">
                {{ row.participant.teamName }}
              </span>
              <span class="hint" style="display: block">{{ row.sub }}</span>
            </span>
            <span class="credits" [class.is-low]="row.low">{{ row.participant.budget }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class PresenceList {
  private readonly store = inject(AuctionStore);

  protected readonly rows = computed<PresenceRow[]>(() => {
    const turnId = this.store.state()?.currentTurnParticipantId;
    return this.store.participants().map((participant) => ({
      participant,
      sub: participant.name + (participant.id === turnId ? ' · chiama ora' : ''),
      low: participant.budget < LOW_CREDITS,
    }));
  });

  protected readonly onlineCount = computed(
    () => this.store.participants().filter((p) => p.online).length,
  );
}

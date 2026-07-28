import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AuctionRules, ReleaseRefund, Role, ROLES } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort } from '../../core/ports';
import {
  RELEASE_REFUND_HINT,
  RELEASE_REFUND_LABEL,
  ROLE_LABEL,
  ROLE_LABEL_PLURAL,
  intOf,
} from '../../shared/ui';

interface SlotField {
  role: Role;
  label: string;
  value: string;
}

/** Le quattro modalità di rimborso, nell'ordine in cui si scelgono. */
const REFUND_MODES: readonly ReleaseRefund[] = [
  'purchase',
  'quotation',
  'average',
  'none',
] as const;

/** Regole di lega. Ogni modifica va su `PUT /rules`: decide il server. */
@Component({
  selector: 'app-admin-rules-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-rules-tab.html',
})
export class AdminRulesTab {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);

  protected readonly rules = this.store.rules;

  protected readonly slotFields = computed<SlotField[]>(() => {
    const slots = this.rules()?.rosterSlots;
    if (!slots) return [];
    return ROLES.map((role) => ({
      role,
      label: ROLE_LABEL_PLURAL[role],
      value: String(slots[role]),
    }));
  });

  protected readonly slotsTotal = computed(() => {
    const slots = this.rules()?.rosterSlots;
    if (!slots) return '';
    const total = ROLES.reduce((n, role) => n + slots[role], 0);
    return `Totale rosa: ${total} calciatori a squadra`;
  });

  protected readonly baseHint = computed(() => {
    const rules = this.rules();
    if (!rules) return '';
    return rules.startPriceMode === 'fixed'
      ? `Ogni chiamata parte da ${rules.startPrice} credito/i, quotazione o meno.`
      : 'Ogni chiamata parte dalla quotazione del listone.';
  });

  protected readonly orderHint = computed(() => {
    const rules = this.rules();
    if (!rules) return '';
    if (rules.callOrder === 'free') {
      return 'Ognuno chiama chi vuole, quando tocca a lui. Caos, ma divertente.';
    }
    const role = this.store.state()?.currentRole;
    const now = role ? ` Ora: ${ROLE_LABEL[role]}i.` : '';
    return `Si completa un reparto alla volta prima di passare al successivo.${now}`;
  });

  /** Le scelte del rimborso, ognuna con la sua etichetta. */
  protected readonly refundModes = REFUND_MODES.map((mode) => ({
    mode,
    label: RELEASE_REFUND_LABEL[mode],
  }));

  protected readonly refundHint = computed(() => {
    const mode = this.rules()?.releaseRefund;
    return mode ? RELEASE_REFUND_HINT[mode] : '';
  });

  private patch(patch: Partial<AuctionRules>): void {
    void this.api.putRules(patch);
  }

  protected setSlot(role: Role, value: string): void {
    const slots = this.rules()?.rosterSlots;
    if (!slots) return;
    this.patch({ rosterSlots: { ...slots, [role]: intOf(value, 0) } });
  }

  protected setBudget(value: string): void {
    this.patch({ budget: intOf(value, 1) });
  }

  protected setTimer(value: string): void {
    this.patch({ bidTimerSeconds: intOf(value, 1) });
  }

  protected setStartPriceMode(mode: AuctionRules['startPriceMode']): void {
    this.patch({ startPriceMode: mode });
  }

  protected setStartPrice(value: string): void {
    this.patch({ startPrice: intOf(value, 1) });
  }

  protected setCallOrder(order: AuctionRules['callOrder']): void {
    this.patch({ callOrder: order });
  }

  /**
   * Rimborso degli svincoli di riparazione. Si può cambiare anche a finestra
   * aperta: vale per i tagli **successivi**, quelli già fatti conservano il
   * rimborso che avevano al momento del taglio (è nella riga `Release`).
   */
  protected setReleaseRefund(mode: ReleaseRefund): void {
    this.patch({ releaseRefund: mode });
  }
}

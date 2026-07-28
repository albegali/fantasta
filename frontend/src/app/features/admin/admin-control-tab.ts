import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { PlayerRow } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort, SkippedPlayer } from '../../core/ports';
import {
  RELEASE_REFUND_LABEL,
  ROLE_LABEL_PLURAL,
  digitsOnly,
  downloadTextFile,
} from '../../shared/ui';

/** Regia: comandi `admin:*` sul socket. Il server resta l'unico a decidere. */
@Component({
  selector: 'app-admin-control-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-control-tab.html',
})
export class AdminControlTab {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);
  private readonly router = inject(Router);

  protected readonly status = this.store.status;
  protected readonly participants = this.store.participants;
  protected readonly isFixedOrder = this.store.isFixedOrder;
  protected readonly isFilling = this.store.isFilling;
  protected readonly isReleasing = this.store.isReleasing;
  protected readonly repairRound = this.store.repairRound;

  /** Reparto in corso e quanti slot resterebbero vuoti chiudendolo adesso. */
  protected readonly currentRoleLabel = computed(() => {
    const role = this.store.currentRole();
    return role ? ROLE_LABEL_PLURAL[role] : null;
  });

  protected readonly leftoverIfClosed = computed(() => {
    const role = this.store.currentRole();
    const rules = this.store.rules();
    if (!role || !rules) return 0;
    return this.participants().reduce(
      (n, p) => n + Math.max(0, rules.rosterSlots[role] - this.store.slotsUsed(p)[role]),
      0,
    );
  });

  /**
   * Con un lotto aperto il server rifiuta l'avanzamento (`LOT_OPEN`): meglio
   * spegnere il bottone che far scoprire il rifiuto con un toast.
   */
  protected readonly canAdvance = computed(() => !this.store.lot());

  /** Anche la riapertura è rifiutata a lotto aperto (`LOT_OPEN`). */
  protected readonly canReopen = computed(() => !this.store.lot());

  /** Slot totali ancora vuoti in tutta la lega: quello che finirà negli svincoli. */
  protected readonly openSlots = computed(() =>
    this.participants().reduce((n, p) => n + this.store.slotsLeft(p), 0),
  );

  // ── riapertura di un lotto (evento `admin:reopenLot`) ──
  protected readonly reopenQuery = signal('');
  protected readonly reopenResults = signal<PlayerRow[]>([]);
  protected readonly reopenPlayer = signal<PlayerRow | null>(null);

  /** Chi ha comprato il calciatore scelto e a quanto: è quel che si sta annullando. */
  protected readonly reopenOwner = computed(() => {
    const player = this.reopenPlayer();
    if (!player) return null;
    for (const participant of this.participants()) {
      const entry = participant.roster.find((r) => r.playerId === player.id);
      if (entry) return { teamName: participant.teamName, price: entry.price };
    }
    return null;
  });

  /** Prezzo da cui ripartirà l'asta: la regola di lega, non il prezzo di vendita. */
  protected readonly reopenPrice = computed(() => {
    const rules = this.store.rules();
    const player = this.reopenPlayer();
    if (!rules || !player) return 1;
    return rules.startPriceMode === 'quotation' ? player.quotation : rules.startPrice;
  });

  // ── mercato di riparazione (evento `admin:startRepair`) ──
  protected readonly extraBudget = signal('0');

  /**
   * Come sopra: il server rifiuta a lotto aperto o a finestra già aperta, quindi
   * il bottone si spegne invece di far scoprire il rifiuto con un toast.
   */
  protected readonly canStartRepair = computed(() => !this.store.lot() && !this.isReleasing());

  /** Quanti tagli hanno già fatto le squadre: è quel che tornerà all'asta. */
  protected readonly releaseCount = computed(() => this.store.releases().length);

  /** Come si legge la regola di rimborso in vigore, per non doverla andare a cercare. */
  protected readonly refundLabel = computed(() => {
    const mode = this.store.rules()?.releaseRefund;
    return mode ? RELEASE_REFUND_LABEL[mode] : '';
  });

  // ── assegnazione manuale (evento `admin:assignManual`) ──
  protected readonly manualQuery = signal('');
  protected readonly manualResults = signal<PlayerRow[]>([]);
  protected readonly manualPlayer = signal<PlayerRow | null>(null);
  protected readonly manualParticipantId = signal('');
  protected readonly manualPrice = signal('1');

  protected readonly canAssign = computed(
    () => !!this.manualPlayer() && !!this.manualParticipantId() && !!this.manualPrice(),
  );

  // ── export delle rose per Fantacalcio.it ──
  protected readonly exporting = signal(false);
  protected readonly exportedFile = signal<string | null>(null);
  protected readonly exportSkipped = signal<SkippedPlayer[]>([]);
  protected readonly exportError = signal<string | null>(null);

  /** Quante righe ci si aspetta nel file: un acquisto, una riga. */
  protected readonly boughtCount = computed(() =>
    this.participants().reduce((n, p) => n + p.roster.length, 0),
  );

  protected readonly skippedLabel = computed(() => {
    const n = this.exportSkipped().length;
    return n === 1 ? '1 acquisto è rimasto fuori' : `${n} acquisti sono rimasti fuori`;
  });

  protected start(): void {
    this.store.adminStart();
  }
  protected pause(): void {
    this.store.adminPause();
  }
  protected resume(): void {
    this.store.adminResume();
  }
  protected skip(): void {
    this.store.adminSkipTurn();
  }

  /**
   * Chiude il reparto in corso e passa al successivo anche se incompleto. Se non
   * resta nessun reparto, apre gli svincoli. Irreversibile.
   */
  protected advanceRole(): void {
    this.store.adminAdvanceRole();
  }

  protected async reset(): Promise<void> {
    await this.api.resetAuction();
  }

  protected onExtraBudget(value: string): void {
    this.extraBudget.set(digitsOnly(value));
  }

  /**
   * Apre il mercato di riparazione: la sala va in finestra di svincolo e ogni
   * squadra taglia dalla propria rosa. La finestra la chiude «Avvia».
   */
  protected startRepair(): void {
    this.store.adminStartRepair(Number.parseInt(this.extraBudget(), 10) || 0);
    this.extraBudget.set('0');
  }

  /**
   * Scarica le rose nel CSV di Fantacalcio.it. Non muta niente: si può rifare
   * quante volte si vuole, anche prima della fine dell'asta.
   */
  protected async exportRosters(): Promise<void> {
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const { filename, csv, skipped } = await this.api.exportRosters();
      downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
      this.exportedFile.set(filename);
      this.exportSkipped.set(skipped);
    } catch {
      this.exportedFile.set(null);
      this.exportSkipped.set([]);
      this.exportError.set('Export non riuscito: controlla il token admin e riprova.');
    } finally {
      this.exporting.set(false);
    }
  }

  protected async goToAuction(): Promise<void> {
    await this.router.navigate(['/asta']);
  }

  /** Cerca fra i **soli assegnati**: sono gli unici lotti che si possono riaprire. */
  protected async searchReopen(value: string): Promise<void> {
    this.reopenQuery.set(value);
    this.reopenPlayer.set(null);
    const q = value.trim();
    this.reopenResults.set(
      q.length > 1 ? await this.api.listPlayers({ q, taken: true, take: 6 }) : [],
    );
  }

  protected chooseReopen(player: PlayerRow): void {
    this.reopenPlayer.set(player);
    this.reopenQuery.set(player.name);
    this.reopenResults.set([]);
  }

  protected reopenLot(): void {
    const player = this.reopenPlayer();
    if (!player) return;
    this.store.adminReopenLot(player.id);
    this.reopenPlayer.set(null);
    this.reopenQuery.set('');
    this.reopenResults.set([]);
  }

  protected async searchManual(value: string): Promise<void> {
    this.manualQuery.set(value);
    this.manualPlayer.set(null);
    const q = value.trim();
    this.manualResults.set(q.length > 1 ? await this.api.listPlayers({ q, take: 6 }) : []);
  }

  protected chooseManual(player: PlayerRow): void {
    this.manualPlayer.set(player);
    this.manualQuery.set(player.name);
    this.manualResults.set([]);
  }

  protected onPrice(value: string): void {
    this.manualPrice.set(digitsOnly(value));
  }

  protected assignManual(): void {
    const player = this.manualPlayer();
    const price = Number.parseInt(this.manualPrice(), 10);
    if (!player || !this.manualParticipantId() || Number.isNaN(price)) return;
    this.store.adminAssignManual(player.id, this.manualParticipantId(), price);
    this.manualPlayer.set(null);
    this.manualQuery.set('');
    this.manualPrice.set('1');
  }
}

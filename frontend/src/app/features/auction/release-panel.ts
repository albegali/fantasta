import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ReleaseEntry, Role, ROLES, RosterEntry } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { Avatar } from '../../shared/avatar';
import { RoleChip } from '../../shared/role-chip';
import { RELEASE_REFUND_HINT, RELEASE_REFUND_LABEL, ROLE_LABEL_PLURAL } from '../../shared/ui';

/** Una riga della mia rosa, con quel che serve a decidere se tagliarla. */
interface CutCandidate {
  entry: RosterEntry;
  /** Stima del rimborso, `null` se la sa solo il server (quotazione/media). */
  refund: number | null;
  /** Perché il bottone è spento; `null` se si può tagliare. */
  blocked: string | null;
}

interface RoleBucket {
  role: Role;
  label: string;
  candidates: CutCandidate[];
}

/**
 * Finestra di svincolo del mercato di riparazione (`status: 'RELEASING'`).
 *
 * Qui ognuno taglia dalla **propria** rosa: niente turni, niente timer, niente
 * rilanci. I buchi che si creano sono quel che tornerà all'asta quando l'admin
 * chiuderà la finestra con «Avvia». Finché è aperta ogni taglio si annulla.
 *
 * Come sempre le regole non sono qui: `blocked` serve solo a spegnere un bottone
 * e spiegarlo, il rifiuto vero arriva dal server come `errorMsg` (AGENTS.md §1).
 */
@Component({
  selector: 'app-release-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, RoleChip],
  templateUrl: './release-panel.html',
})
export class ReleasePanel {
  private readonly store = inject(AuctionStore);

  protected readonly me = this.store.me;
  protected readonly round = this.store.repairRound;
  protected readonly myReleases = this.store.myReleases;

  protected readonly refundLabel = computed(() => {
    const mode = this.store.rules()?.releaseRefund;
    return mode ? RELEASE_REFUND_LABEL[mode] : '';
  });
  protected readonly refundHint = computed(() => {
    const mode = this.store.rules()?.releaseRefund;
    return mode ? RELEASE_REFUND_HINT[mode] : '';
  });

  /** I tagli degli altri: la sala vede crescere il lotto che tornerà all'asta. */
  protected readonly othersReleases = computed<ReleaseEntry[]>(() => {
    const meId = this.me()?.id;
    return this.store.releases().filter((r) => r.participantId !== meId);
  });

  /** La mia rosa per reparto, con la stima del rimborso su ogni riga. */
  protected readonly buckets = computed<RoleBucket[]>(() => {
    const me = this.me();
    if (!me) return [];
    return ROLES.map((role) => ({
      role,
      label: ROLE_LABEL_PLURAL[role],
      candidates: me.roster
        .filter((entry) => entry.role === role)
        .sort((a, b) => b.price - a.price) // i più cari in testa: si taglia per fare cassa
        .map((entry) => this.toCandidate(entry)),
    })).filter((bucket) => bucket.candidates.length > 0);
  });

  /** Quanti slot ho già liberato: è il conto che interessa a chi sta decidendo. */
  protected readonly freed = computed(() => this.myReleases().length);

  /** Crediti rientrati con i miei tagli. */
  protected readonly recovered = computed(() =>
    this.myReleases().reduce((n, r) => n + r.refund, 0),
  );

  protected release(entry: RosterEntry): void {
    this.store.release(entry.playerId);
  }

  protected undo(release: ReleaseEntry): void {
    this.store.unrelease(release.playerId);
  }

  /**
   * La guardia anti-stallo del server, ripetuta qui **solo** quando il rimborso è
   * calcolabile lato client (`none`/`purchase`): con `quotation`/`average` la
   * quotazione non è nella rosa, quindi il bottone resta acceso e a rifiutare
   * eventualmente è il server.
   */
  private toCandidate(entry: RosterEntry): CutCandidate {
    const me = this.me()!;
    const refund = this.store.refundPreview(entry);
    if (refund === null) return { entry, refund, blocked: null };
    const slotsAfter = this.store.slotsLeft(me) + 1;
    const budgetAfter = me.budget + refund;
    return {
      entry,
      refund,
      blocked:
        budgetAfter < slotsAfter
          ? `Ti servirebbero ${slotsAfter} crediti per richiudere la rosa, ne avresti ${budgetAfter}.`
          : null,
    };
  }
}

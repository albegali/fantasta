import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';

import { Participant } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { ApiPort } from '../../core/ports';
import { Avatar } from '../../shared/avatar';
import { digitsOnly } from '../../shared/ui';

/** Attesa prima di mandare al server quello che l'admin sta digitando. */
const DRAFT_FLUSH_MS = 500;

/** Quanto resta scritto «copiato» sul bottone del link. */
const COPIED_MS = 1800;

interface Draft {
  name?: string;
  teamName?: string;
  budget?: string;
}

interface Row {
  participant: Participant;
  pos: number;
  name: string;
  teamName: string;
  credits: string;
  code: string;
  /** URL completo del magic link, vuoto se il server non l'ha mandato. */
  link: string;
}

/** Lega e partecipanti: nomi, ordine di chiamata, credenziali d'accesso. */
@Component({
  selector: 'app-admin-league-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar],
  templateUrl: './admin-league-tab.html',
})
export class AdminLeagueTab {
  private readonly store = inject(AuctionStore);
  private readonly api = inject(ApiPort);

  protected readonly rules = this.store.rules;
  protected readonly showCodes = signal(false);
  /** Squadra il cui link è appena finito negli appunti. */
  protected readonly copiedId = signal<string | null>(null);
  /**
   * Ripiego quando gli appunti non sono disponibili (contesto non sicuro, permesso
   * negato): il link si mostra e l'admin lo copia a mano.
   */
  protected readonly revealed = signal<{ id: string; url: string } | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Un timer per riga: due modifiche su righe diverse non si annullano. */
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Ordine di chiamata come fonte dell'ordinamento; le code orfane in fondo. */
  private readonly ordered = computed<Participant[]>(() => {
    const participants = this.store.participants();
    const order = this.store.state()?.turnOrder ?? [];
    const inOrder = order
      .map((id) => participants.find((p) => p.id === id))
      .filter((p): p is Participant => !!p);
    const rest = participants.filter((p) => !order.includes(p.id));
    return [...inOrder, ...rest];
  });

  protected readonly rows = computed<Row[]>(() =>
    this.ordered().map((participant, i) => {
      const draft = this.drafts()[participant.id] ?? {};
      return {
        participant,
        pos: i + 1,
        name: draft.name ?? participant.name,
        teamName: draft.teamName ?? participant.teamName,
        credits: draft.budget ?? String(participant.budget),
        code: this.showCodes() ? (participant.accessCode ?? '——————') : '••••••',
        link: magicLink(participant),
      };
    }),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const timer of this.flushTimers.values()) clearTimeout(timer);
      this.flushTimers.clear();
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
    });
  }

  protected toggleCodes(): void {
    this.showCodes.update((v) => !v);
  }

  protected setLeagueName(value: string): void {
    void this.api.putRules({ leagueName: value });
  }

  protected setAuctionName(value: string): void {
    void this.api.putRules({ auctionName: value });
  }

  protected draft(id: string, field: keyof Draft, value: string): void {
    const next = field === 'budget' ? digitsOnly(value) : value;
    this.drafts.update((all) => ({ ...all, [id]: { ...all[id], [field]: next } }));
    const pending = this.flushTimers.get(id);
    if (pending) clearTimeout(pending);
    this.flushTimers.set(
      id,
      setTimeout(() => void this.flush(id), DRAFT_FLUSH_MS),
    );
  }

  private async flush(id: string): Promise<void> {
    this.flushTimers.delete(id);
    const draft = this.drafts()[id];
    if (!draft) return;
    await this.api.upsertParticipant({
      id,
      ...(draft.name != null ? { name: draft.name.trim() || 'Senza nome' } : {}),
      ...(draft.teamName != null
        ? { teamName: draft.teamName.trim() || 'Squadra senza nome' }
        : {}),
      ...(draft.budget != null ? { budget: Number.parseInt(draft.budget, 10) || 0 } : {}),
    });
    this.drafts.update((all) => {
      const { [id]: _dropped, ...rest } = all;
      return rest;
    });
  }

  protected move(index: number, delta: number): void {
    const ids = this.ordered().map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void this.api.setTurnOrder(ids);
  }

  protected shuffle(): void {
    const ids = this.ordered()
      .map((p) => p.id)
      .sort(() => Math.random() - 0.5);
    void this.api.setTurnOrder(ids);
  }

  protected add(): void {
    void this.api.upsertParticipant({});
  }

  protected remove(id: string): void {
    void this.api.deleteParticipant(id);
  }

  protected regenerate(id: string): void {
    this.showCodes.set(true);
    void this.api.regenerateCode(id);
  }

  /**
   * Nuovo link per una squadra. Il vecchio smette di funzionare e chi era dentro
   * con quella sessione viene buttato fuori: si usa quando il link è finito nel
   * gruppo sbagliato, non per abitudine.
   */
  protected regenerateLink(id: string): void {
    this.revealed.set(null);
    void this.api.regenerateLink(id);
  }

  /** Il link negli appunti, pronto da incollare in chat. */
  protected async copyLink(row: Row): Promise<void> {
    if (!row.link) return;
    try {
      await navigator.clipboard.writeText(row.link);
      this.copiedId.set(row.participant.id);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedId.set(null), COPIED_MS);
    } catch {
      // Niente appunti (http non sicuro, permesso negato): lo si mostra e via.
      this.revealed.set({ id: row.participant.id, url: row.link });
    }
  }
}

/**
 * `<origin>/j/<magicToken>` — l'URL lo compone il client, così vale in locale e in
 * produzione senza che il server debba conoscere il suo indirizzo pubblico.
 */
function magicLink(participant: Participant): string {
  return participant.magicToken ? `${window.location.origin}/j/${participant.magicToken}` : '';
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuctionStore } from '../../core/auction.store';
import { SessionStore } from '../../core/session.store';
import { Avatar } from '../../shared/avatar';

/**
 * Accesso alla sala **a mano**: scegli la squadra, digita il codice a 6 caratteri.
 * La via normale è il magic link (`/j/<token>`, vedi `magic-link-page.ts`): qui ci
 * si arriva quando il link è andato perso, e ci entra l'admin col token condiviso.
 */
@Component({
  selector: 'app-join-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar],
  templateUrl: './join-page.html',
})
export class JoinPage {
  private readonly store = inject(AuctionStore);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  protected readonly rules = this.store.rules;
  protected readonly teams = this.store.participants;

  protected readonly pickId = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly loginError = signal('');
  protected readonly asAdmin = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    void this.skipIfAlreadyIn();
  }

  /** Sessione salvata ancora buona: non si chiede di nuovo il codice. */
  private async skipIfAlreadyIn(): Promise<void> {
    await this.store.init();
    if (!this.session.joined()) return;
    await this.router.navigate([this.session.isAdmin() ? '/admin' : '/asta'], {
      replaceUrl: true,
    });
  }

  protected pick(id: string): void {
    this.pickId.set(id);
    this.loginError.set('');
  }

  protected onCode(value: string): void {
    this.code.set(value.toUpperCase().slice(0, 12));
    this.loginError.set('');
  }

  protected toggleAdmin(): void {
    this.asAdmin.update((v) => !v);
    this.pickId.set(null);
    this.loginError.set('');
  }

  protected async join(): Promise<void> {
    if (this.busy()) return;
    const admin = this.asAdmin();
    if (!admin && !this.pickId()) {
      this.loginError.set('Scegli prima la tua squadra.');
      return;
    }
    if (!this.code().trim()) {
      this.loginError.set(admin ? 'Serve il token di admin.' : 'Serve il codice.');
      return;
    }

    this.busy.set(true);
    const ack = await this.store.auth(this.code().trim(), admin ? undefined : this.pickId()!);
    this.busy.set(false);

    if (!ack?.ok) {
      this.loginError.set(ack?.message || 'Codice sbagliato. Chiedilo all’admin, con garbo.');
      return;
    }
    this.code.set('');
    this.loginError.set('');
    await this.router.navigate([ack.isAdmin ? '/admin' : '/asta']);
  }
}

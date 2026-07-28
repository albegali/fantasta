import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuctionStore } from '../../core/auction.store';

/**
 * Ingresso dal magic link: `/j/<magicToken>`. Non c'è niente da scegliere e
 * niente da digitare — il token dice già di che squadra si tratta, il server
 * risponde con la sessione e si va in sala.
 *
 * Il token **sparisce dall'URL** appena usato (`replaceUrl`): non deve restare
 * nella cronologia del browser né in uno screenshot della sala girato al gruppo.
 */
@Component({
  selector: 'app-magic-link-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap-login">
      <div class="kicker-lg">{{ rules()?.leagueName }}</div>
      <h1 class="title-xl" style="margin: 2px 0 4px">{{ rules()?.auctionName }}</h1>
      @if (error()) {
        <p class="lead" style="margin: 0 0 18px">{{ error() }}</p>
        <button type="button" class="btn btn-primary" (click)="toJoin()">Vai all'accesso</button>
      } @else {
        <p class="lead" style="margin: 0 0 18px">Ti sto facendo entrare…</p>
      }
    </div>
  `,
})
export class MagicLinkPage {
  private readonly store = inject(AuctionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly rules = this.store.rules;
  protected readonly error = signal('');

  constructor() {
    void this.enter();
  }

  private async enter(): Promise<void> {
    await this.store.init();
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!token) {
      this.error.set('Link incompleto.');
      return;
    }

    const ack = await this.store.auth(token);
    if (!ack?.ok) {
      this.error.set(
        ack?.message || 'Questo link non vale più. Chiedine uno nuovo all’admin, con garbo.',
      );
      return;
    }
    await this.router.navigate(['/asta'], { replaceUrl: true });
  }

  protected toJoin(): void {
    void this.router.navigate(['/'], { replaceUrl: true });
  }
}

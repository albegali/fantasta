import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuctionStore } from './core/auction.store';
import { SessionStore } from './core/session.store';

interface NavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(AuctionStore);
  protected readonly session = inject(SessionStore);

  protected readonly rules = this.store.rules;
  protected readonly error = this.store.error;

  protected readonly navItems = computed<NavItem[]>(() => {
    const items: NavItem[] = [{ path: '/asta', label: 'Asta' }];
    if (this.session.participantId()) items.push({ path: '/rosa', label: 'Rosa' });
    items.push({ path: '/lega', label: 'Lega' }, { path: '/storia', label: 'Storia' });
    if (this.session.isAdmin()) items.push({ path: '/admin', label: 'Admin' });
    return items;
  });

  protected readonly myCredits = computed(() => this.store.me()?.budget ?? null);

  constructor() {
    void this.store.init();
  }
}

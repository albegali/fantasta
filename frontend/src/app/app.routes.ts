import { Routes } from '@angular/router';

import { adminGuard, joinedGuard } from './core/joined.guard';

/** Alberatura di `frontend-handoff.md` §5. */
export const routes: Routes = [
  {
    path: '',
    title: 'Accesso · Asta Fantacalcio',
    loadComponent: () => import('./features/join/join-page').then((m) => m.JoinPage),
  },
  {
    // Magic link: `/j/<magicToken>`. Percorso corto perché finisce in un messaggio.
    path: 'j/:token',
    title: 'Accesso · Asta Fantacalcio',
    loadComponent: () => import('./features/join/magic-link-page').then((m) => m.MagicLinkPage),
  },
  {
    path: 'asta',
    title: 'Asta live',
    canActivate: [joinedGuard],
    loadComponent: () => import('./features/auction/auction-page').then((m) => m.AuctionPage),
  },
  {
    path: 'rosa',
    title: 'La mia rosa',
    canActivate: [joinedGuard],
    loadComponent: () => import('./features/roster/roster-page').then((m) => m.RosterPage),
  },
  {
    path: 'lega',
    title: 'Lega',
    canActivate: [joinedGuard],
    loadComponent: () => import('./features/league/league-page').then((m) => m.LeaguePage),
  },
  {
    path: 'storia',
    title: 'Telecronaca',
    canActivate: [joinedGuard],
    loadComponent: () => import('./features/log/log-page').then((m) => m.LogPage),
  },
  {
    path: 'admin',
    title: 'Admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage),
  },
  { path: '**', redirectTo: '' },
];

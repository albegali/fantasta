import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuctionStore } from './auction.store';
import { SessionStore } from './session.store';

/**
 * Fuori dalla sala si torna all'accesso — ma prima si aspetta l'avvio, che è
 * anche il momento in cui una sessione salvata viene ripresa (`AuctionStore.init`).
 * Senza questa attesa, ricaricare la pagina su `/asta` rimbalzerebbe all'accesso
 * un istante prima che il server confermi chi siamo.
 */
export const joinedGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const session = inject(SessionStore);
  await inject(AuctionStore).init();
  return session.joined() ? true : router.createUrlTree(['/']);
};

/** L'admin non passa dalla scelta squadra; gli altri sì. */
export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const session = inject(SessionStore);
  await inject(AuctionStore).init();
  if (!session.joined()) return router.createUrlTree(['/']);
  return session.isAdmin() ? true : router.createUrlTree(['/asta']);
};

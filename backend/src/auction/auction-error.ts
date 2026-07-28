import { ErrorCode } from './dto/events';

/**
 * Rifiuto di dominio. Il gateway lo traduce in `errorMsg` (+ ack negativo) verso
 * il solo socket che ha provato l'azione: gli altri client non devono vedere i
 * tentativi falliti di chi rilancia troppo tardi.
 */
export class AuctionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuctionError';
  }
}

export function isAuctionError(e: unknown): e is AuctionError {
  return e instanceof AuctionError;
}

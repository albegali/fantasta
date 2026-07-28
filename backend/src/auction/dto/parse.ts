import { AuctionError } from '../auction-error';
import { ErrorCode } from './events';

/**
 * Validazione della **forma** dei payload socket (AGENTS.md §3). I payload
 * arrivano da un client: prima di darli al motore vanno ridotti a tipi certi.
 * Le regole di dominio (turno, budget, slot) restano nell'engine.
 *
 * Non usiamo il `ValidationPipe` globale perché sui gateway produrrebbe una
 * `WsException` su un canale (`exception`) che il client non ascolta: qui invece
 * ogni rifiuto esce come `errorMsg`, uguale a tutti gli altri.
 */

export function asInt(value: unknown, code: ErrorCode): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new AuctionError(code, 'Dato non valido.');
  }
  return n;
}

export function asOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return asInt(value, 'BID_INVALID');
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

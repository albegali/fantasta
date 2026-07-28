import { ReleaseRefund, Role } from '../core/auction-events';

/** Etichette lunghe dei reparti — le stesse del motore d'asta. */
export const ROLE_LABEL: Record<Role, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

export const ROLE_LABEL_PLURAL: Record<Role, string> = {
  P: 'Portieri',
  D: 'Difensori',
  C: 'Centrocampisti',
  A: 'Attaccanti',
};

/** Come si legge la regola di rimborso degli svincoli, nella tab Regole e in sala. */
export const RELEASE_REFUND_LABEL: Record<ReleaseRefund, string> = {
  none: 'Nessun rimborso',
  purchase: 'Prezzo d’acquisto',
  quotation: 'Quotazione attuale',
  average: 'Media prezzo e quotazione',
};

/** La stessa regola detta per esteso: va sotto al selettore e nel pannello svincoli. */
export const RELEASE_REFUND_HINT: Record<ReleaseRefund, string> = {
  none: 'Chi taglia non recupera niente: si ripara col solo budget residuo.',
  purchase: 'Torna esattamente quel che si era speso all’asta.',
  quotation: 'Si rivende al valore di listone di oggi, non a quello pagato ad agosto.',
  average: 'Metà del prezzo pagato e metà della quotazione, arrotondato per difetto.',
};

/** Colore di fallback quando il partecipante non ne porta uno (rampa neutra 500). */
export const FALLBACK_COLOR = 'var(--color-neutral-500)';

export function initialsOf(name: string | null | undefined): string {
  return (name || '?').slice(0, 2).toUpperCase();
}

/** Solo cifre — usato dai campi numerici (i crediti sono interi, AGENTS.md §5). */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** Interpreta un campo numerico applicando un minimo; ritorna `min` se vuoto. */
export function intOf(value: string, min: number): number {
  const n = Number.parseInt(digitsOnly(value), 10);
  return Number.isNaN(n) ? min : Math.max(min, n);
}

/**
 * Salva del testo come file. Le rotte d'export vogliono `x-admin-token`, quindi un
 * `<a download href>` verso l'API non basta: il contenuto arriva via HttpClient e
 * il file lo confeziona il browser da un blob.
 */
export function downloadTextFile(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

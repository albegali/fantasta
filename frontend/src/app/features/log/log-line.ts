import { AuctionLogEntry, AuctionLogType, Role } from '../../core/auction-events';

/**
 * Da fatto a frase. Il server manda i **fatti** (`AuctionLogEntry`), qui nasce la
 * riga che si legge: è l'unico posto dove sta il tono della telecronaca, e resta
 * una funzione pura, così si testa senza montare niente (`log-line.spec.ts`).
 */

/** Come si legge una riga: serve al colore, non alla logica. */
export type LogKind = 'purchase' | 'bid' | 'admin' | 'phase';

export interface LogLine {
  seq: number;
  /** `hh:mm` — l'ora della sala, non i millisecondi. */
  time: string;
  text: string;
  /** Coda della frase, in grigio: "3 rilanci", "si ribatte da 1". */
  note: string | null;
  /** Crediti da mostrare a destra; `null` per le righe di fase. */
  amount: number | null;
  kind: LogKind;
  teamName: string | null;
  participantId: string | null;
  role: Role | null;
}

const KIND: Record<AuctionLogType, LogKind> = {
  start: 'phase',
  nominate: 'bid',
  bid: 'bid',
  assigned: 'purchase',
  claim: 'purchase',
  manual: 'purchase',
  reopen: 'admin',
  skip: 'admin',
  roleClosed: 'admin',
  pause: 'phase',
  resume: 'phase',
  filling: 'phase',
  finished: 'phase',
  reset: 'phase',
  repairStart: 'phase',
  // Uno svincolo muove crediti come un acquisto, solo al contrario: va letto
  // con lo stesso peso, non come una riga di fase.
  release: 'purchase',
  unrelease: 'admin',
};

export function toLogLine(entry: AuctionLogEntry): LogLine {
  const team = entry.teamName ?? 'Una squadra';
  const player = entry.playerName ?? 'un calciatore';
  const kind = KIND[entry.type];
  return {
    seq: entry.seq,
    time: formatTime(entry.at),
    text: text(entry, team, player),
    note: note(entry),
    amount: kind === 'phase' ? null : entry.price,
    kind,
    teamName: entry.teamName,
    participantId: entry.participantId,
    role: entry.role,
  };
}

function text(entry: AuctionLogEntry, team: string, player: string): string {
  switch (entry.type) {
    case 'start':
      return 'Sala aperta';
    case 'nominate':
      return `${team} chiama ${player}`;
    case 'bid':
      return `${team} rilancia su ${player}`;
    case 'assigned':
      return `${player} a ${team}`;
    case 'claim':
      return `${team} completa la rosa con ${player}`;
    case 'manual':
      return `${player} assegnato a mano a ${team}`;
    case 'reopen':
      return `Lotto riaperto: ${player} torna all'asta`;
    case 'skip':
      return entry.playerName
        ? `Turno di ${team} saltato, ${player} annullato`
        : `Turno di ${team} saltato`;
    case 'roleClosed':
      return 'Reparto chiuso in anticipo';
    case 'pause':
      return 'Asta in pausa';
    case 'resume':
      return 'Si riprende';
    case 'filling':
      return 'Svincoli aperti: rose da completare';
    case 'finished':
      return 'Asta conclusa';
    case 'reset':
      return 'Asta azzerata';
    case 'repairStart':
      return 'Mercato di riparazione aperto';
    case 'release':
      return `${team} svincola ${player}`;
    case 'unrelease':
      return `${team} ci ripensa`;
  }
}

function note(entry: AuctionLogEntry): string | null {
  switch (entry.type) {
    // Il rimborso ha già il suo numero a destra: qui va detto **a chi** è andato.
    case 'reopen': {
      const who = entry.teamName ? `rimborsata ${entry.teamName}` : 'compratore rimborsato';
      return entry.detail ? `${who}, ${entry.detail}` : who;
    }
    case 'filling':
      return entry.price ? `${entry.price} credito a testa` : null;
    default:
      return entry.detail;
  }
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

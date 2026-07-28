import {
  AuctionLogEntry,
  AuctionLogType,
  AuctionRules,
  AuctionState,
  Participant,
  PlayerRow,
  Role,
} from './auction-events';

/**
 * I due punti d'iniezione del prototipo (`const { socket, api } = createMockBackend()`)
 * diventati classi astratte Angular: `SocketPort` per il realtime, `ApiPort` per il
 * REST d'admin. Sostituire l'implementazione non cambia una riga di UI —
 * vedi `frontend-handoff.md` §1 e `core/providers.ts`.
 */

export type Ack<T> = (response: T) => void;

export abstract class SocketPort {
  abstract connect(): void;
  abstract disconnect(): void;
  abstract on<T>(event: string, handler: (payload: T) => void): void;
  abstract off<T>(event: string, handler: (payload: T) => void): void;
  abstract emit<A = unknown>(event: string, payload?: unknown, ack?: Ack<A>): void;
}

export interface ImportResult {
  imported: number;
  updated: number;
  total: number;
}

export interface LastImport {
  filename: string;
  at: string;
  count: number;
}

export interface PlayerQuery {
  /** Ricerca su cognome o squadra. Vuoto = tutto il listone. */
  q?: string;
  /** Filtra per reparto — con `callOrder: 'fixed'` è il reparto in corso. */
  role?: Role | null;
  /** `true` = solo i calciatori non ancora assegnati. */
  available?: boolean;
  /** `true` = **solo** i già assegnati (Regia: riapertura di un lotto). */
  taken?: boolean;
  take?: number;
}

/** Acquisto rimasto fuori dall'export: senza id Fantacalcio.it non è importabile. */
export interface SkippedPlayer {
  teamName: string;
  name: string;
  realTeam: string;
  price: number;
}

/** Rose pronte per il caricamento su Fantacalcio.it. Il file lo confeziona il client. */
export interface RostersExport {
  filename: string;
  csv: string;
  skipped: SkippedPlayer[];
}

/** Pagina di telecronaca: la più recente in testa. */
export interface LogQuery {
  take?: number;
  /** Cursore: solo le righe **precedenti** a questo `seq` (esclusivo). */
  before?: number;
  /** Filtro per tipo; vuoto = tutta la cronaca. */
  types?: AuctionLogType[];
  participantId?: string;
}

/** Patch parziale di un partecipante; senza `id` è una creazione. */
export type ParticipantPatch = Partial<
  Pick<Participant, 'id' | 'name' | 'teamName' | 'budget' | 'avatarUrl' | 'color'>
>;

export abstract class ApiPort {
  abstract getState(): Promise<AuctionState>;
  abstract getRules(): Promise<AuctionRules>;
  abstract putRules(patch: Partial<AuctionRules>): Promise<AuctionRules>;
  /** Sempre ordinati per **quotazione decrescente**: i più costosi in testa. */
  abstract listPlayers(query?: PlayerQuery): Promise<PlayerRow[]>;
  abstract getLastImport(): Promise<LastImport>;
  abstract importPlayers(file: File): Promise<ImportResult>;
  abstract listParticipants(): Promise<Participant[]>;
  abstract upsertParticipant(patch: ParticipantPatch): Promise<Participant[]>;
  abstract deleteParticipant(participantId: string): Promise<Participant[]>;
  abstract setTurnOrder(ids: string[]): Promise<string[]>;
  /** Nuovo codice a 6 caratteri. Butta giù le sessioni aperte di quella squadra. */
  abstract regenerateCode(participantId: string): Promise<Participant | null>;
  /** Nuovo magic link: il vecchio smette di funzionare, le sessioni cadono. */
  abstract regenerateLink(participantId: string): Promise<Participant | null>;
  abstract resetAuction(): Promise<AuctionState>;
  /**
   * Storia della telecronaca, la più recente in testa. Lo snapshot `state` porta
   * solo la coda recente (`LOG_TAIL`): tutto il resto passa da qui.
   */
  abstract getLog(query?: LogQuery): Promise<AuctionLogEntry[]>;
  /** Sola lettura: si può chiamare anche ad asta in corso. */
  abstract exportRosters(): Promise<RostersExport>;
}

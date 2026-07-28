import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  AuctionLogEntry,
  AuctionRules,
  AuctionState,
  Participant,
  PlayerRow,
} from './auction-events';
import {
  ApiPort,
  ImportResult,
  LastImport,
  LogQuery,
  ParticipantPatch,
  PlayerQuery,
  RostersExport,
} from './ports';
import { SessionStore } from './session.store';

/**
 * REST reale — rotte di `frontend/README.md`. Le scritture viaggiano con
 * `x-admin-token`: il token è quello inserito al login dall'admin.
 */
@Injectable()
export class RestApiAdapter extends ApiPort {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly base = environment.apiUrl;

  private adminHeaders(): { headers: HttpHeaders } {
    return { headers: new HttpHeaders({ 'x-admin-token': this.session.token() }) };
  }

  /**
   * Bootstrap **pre-auth** della schermata d'accesso: serve la lista squadre e
   * le regole prima che esista una socket autenticata. Lo snapshot vero è
   * l'evento `state` (CLAUDE.md §5) — questo è solo il valore iniziale.
   */
  override async getState(): Promise<AuctionState> {
    const [rules, participants] = await Promise.all([this.getRules(), this.listParticipants()]);
    return {
      status: 'IDLE',
      rules,
      participants,
      turnOrder: participants.map((p) => p.id),
      currentTurnParticipantId: participants[0]?.id ?? '',
      currentRole: null,
      closedRoles: [],
      lot: null,
      lastAssigned: null,
      repairRound: 0,
      releases: [],
      log: [],
    };
  }

  override getRules(): Promise<AuctionRules> {
    return firstValueFrom(this.http.get<AuctionRules>(`${this.base}/rules`));
  }

  override putRules(patch: Partial<AuctionRules>): Promise<AuctionRules> {
    return firstValueFrom(
      this.http.put<AuctionRules>(`${this.base}/rules`, patch, this.adminHeaders()),
    );
  }

  override listPlayers({
    q = '',
    role = null,
    available = false,
    taken = false,
    take = 50,
  }: PlayerQuery = {}): Promise<PlayerRow[]> {
    const params: Record<string, string> = { take: String(take) };
    if (q.trim()) params['q'] = q.trim();
    if (role) params['role'] = role;
    if (available) params['available'] = 'true';
    if (taken) params['taken'] = 'true';
    return firstValueFrom(this.http.get<PlayerRow[]>(`${this.base}/players`, { params }));
  }

  override getLastImport(): Promise<LastImport> {
    return firstValueFrom(this.http.get<LastImport>(`${this.base}/players/last-import`));
  }

  override importPlayers(file: File): Promise<ImportResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<ImportResult>(`${this.base}/players/import`, body, this.adminHeaders()),
    );
  }

  override listParticipants(): Promise<Participant[]> {
    return firstValueFrom(this.http.get<Participant[]>(`${this.base}/participants`));
  }

  override upsertParticipant(patch: ParticipantPatch): Promise<Participant[]> {
    const { id, ...body } = patch;
    const call = id
      ? this.http.patch<unknown>(`${this.base}/participants/${id}`, body, this.adminHeaders())
      : this.http.post<unknown>(`${this.base}/participants`, body, this.adminHeaders());
    return firstValueFrom(call).then(() => this.listParticipants());
  }

  override deleteParticipant(participantId: string): Promise<Participant[]> {
    return firstValueFrom(
      this.http.delete<unknown>(`${this.base}/participants/${participantId}`, this.adminHeaders()),
    ).then(() => this.listParticipants());
  }

  override setTurnOrder(ids: string[]): Promise<string[]> {
    return firstValueFrom(
      this.http.put<{ turnOrder: string[] }>(
        `${this.base}/rules/turn-order`,
        { turnOrder: ids },
        this.adminHeaders(),
      ),
    ).then((r) => r.turnOrder ?? ids);
  }

  override regenerateCode(participantId: string): Promise<Participant | null> {
    return firstValueFrom(
      this.http.post<Participant>(
        `${this.base}/participants/${participantId}/regenerate-code`,
        {},
        this.adminHeaders(),
      ),
    );
  }

  override regenerateLink(participantId: string): Promise<Participant | null> {
    return firstValueFrom(
      this.http.post<Participant>(
        `${this.base}/participants/${participantId}/regenerate-link`,
        {},
        this.adminHeaders(),
      ),
    );
  }

  override resetAuction(): Promise<AuctionState> {
    return firstValueFrom(
      this.http.post<unknown>(`${this.base}/participants/reset-auction`, {}, this.adminHeaders()),
    ).then(() => this.getState());
  }

  /** Telecronaca: rotta pubblica, la legge anche il partecipante. */
  override getLog({ take = 200, before, types, participantId }: LogQuery = {}): Promise<
    AuctionLogEntry[]
  > {
    const params: Record<string, string> = { take: String(take) };
    if (before !== undefined) params['before'] = String(before);
    if (types?.length) params['type'] = types.join(',');
    if (participantId) params['participantId'] = participantId;
    return firstValueFrom(this.http.get<AuctionLogEntry[]>(`${this.base}/log`, { params }));
  }

  /**
   * Rotta JSON e non `/export/rosters.csv`: la Regia deve poter dire all'admin
   * *quali* acquisti sono rimasti fuori, e un download diretto non lo direbbe.
   */
  override exportRosters(): Promise<RostersExport> {
    return firstValueFrom(
      this.http.get<RostersExport>(`${this.base}/export/rosters`, this.adminHeaders()),
    );
  }
}

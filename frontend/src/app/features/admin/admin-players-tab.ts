import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { PlayerRow, Role, ROLES } from '../../core/auction-events';
import { ApiPort } from '../../core/ports';
import { RoleChip } from '../../shared/role-chip';

interface RoleStat {
  role: Role;
  count: number;
}

/** Listone: import dell'xlsx di Fantacalcio.it e stato dei calciatori. */
@Component({
  selector: 'app-admin-players-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleChip],
  templateUrl: './admin-players-tab.html',
})
export class AdminPlayersTab {
  private readonly api = inject(ApiPort);

  protected readonly players = signal<PlayerRow[]>([]);
  protected readonly status = signal('Caricamento del listone…');
  protected readonly dragOver = signal(false);
  protected readonly busy = signal(false);

  protected readonly stats = computed<RoleStat[]>(() =>
    ROLES.map((role) => ({ role, count: this.players().filter((p) => p.role === role).length })),
  );

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    const [players, last] = await Promise.all([
      this.api.listPlayers({ take: 1000 }),
      this.api.getLastImport().catch(() => null),
    ]);
    this.players.set(players);
    this.status.set(
      last
        ? `${last.filename} · ${players.length} calciatori · importato il ${last.at}`
        : `${players.length} calciatori a listone`,
    );
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.upload(file);
  }

  protected onPick(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (file) void this.upload(file);
    input.value = '';
  }

  private async upload(file: File): Promise<void> {
    this.busy.set(true);
    this.status.set(`Import di ${file.name} in corso…`);
    try {
      const result = await this.api.importPlayers(file);
      this.status.set(
        `${file.name} · ${result.imported} nuovi, ${result.updated} aggiornati, ${result.total} totali`,
      );
      await this.reload();
    } catch {
      this.status.set(`Import di ${file.name} fallito. Controlla il file e il token di admin.`);
    } finally {
      this.busy.set(false);
    }
  }
}

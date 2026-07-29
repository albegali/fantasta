import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { FALLBACK_COLOR, initialsOf, photoUrl } from './ui';

/**
 * Foto della squadra se c'è (`src`), altrimenti il pallino con le iniziali e il
 * colore del partecipante.
 *
 * L'immagine è un **URL esterno** e può non caricarsi — link morto, hotlink
 * bloccato, offline: `(error)` ricade sulle iniziali, così una foto rotta non
 * lascia un buco in sala. Si ricorda **quale** URL ha fallito, non un flag: se
 * l'admin lo corregge, il nuovo tentativo parte da sé.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #face>
      @if (photo(); as url) {
        <img
          class="avatar"
          alt=""
          referrerpolicy="no-referrer"
          [style.--avatar-size.px]="size()"
          [src]="url"
          (error)="onError()"
        />
      } @else {
        <span class="avatar" [style.--avatar-size.px]="size()" [style.--avatar-bg]="bg()">{{
          initials()
        }}</span>
      }
    </ng-template>

    @if (online() === null) {
      <ng-container [ngTemplateOutlet]="face" />
    } @else {
      <span class="avatar-wrap" [style.--avatar-size.px]="size()">
        <ng-container [ngTemplateOutlet]="face" />
        <span class="avatar-dot" [class.is-online]="online()"></span>
      </span>
    }
  `,
})
export class Avatar {
  readonly name = input<string | null>(null);
  readonly color = input<string | null | undefined>(null);
  readonly size = input(28);
  /** URL dell'immagine; `null`/vuoto = iniziali. */
  readonly src = input<string | null | undefined>(null);
  /** `null` = nessun indicatore di presenza. */
  readonly online = input<boolean | null>(null);

  /** L'URL che non si è caricato, così un URL corretto riprova da solo. */
  private readonly broken = signal<string | null>(null);

  protected readonly initials = computed(() => initialsOf(this.name()));
  protected readonly bg = computed(() => this.color() || FALLBACK_COLOR);

  protected readonly photo = computed(() => photoUrl(this.src(), this.broken()));

  protected onError(): void {
    this.broken.set(this.src()?.trim() ?? null);
  }
}

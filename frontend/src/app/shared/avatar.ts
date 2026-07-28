import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FALLBACK_COLOR, initialsOf } from './ui';

/** Pallino con le iniziali; il colore arriva dal partecipante. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (online() === null) {
      <span class="avatar" [style.--avatar-size.px]="size()" [style.--avatar-bg]="bg()">{{
        initials()
      }}</span>
    } @else {
      <span class="avatar-wrap" [style.--avatar-size.px]="size()">
        <span class="avatar" [style.--avatar-size.px]="size()" [style.--avatar-bg]="bg()">{{
          initials()
        }}</span>
        <span class="avatar-dot" [class.is-online]="online()"></span>
      </span>
    }
  `,
})
export class Avatar {
  readonly name = input<string | null>(null);
  readonly color = input<string | null | undefined>(null);
  readonly size = input(28);
  /** `null` = nessun indicatore di presenza. */
  readonly online = input<boolean | null>(null);

  protected readonly initials = computed(() => initialsOf(this.name()));
  protected readonly bg = computed(() => this.color() || FALLBACK_COLOR);
}

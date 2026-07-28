import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Role } from '../core/auction-events';
import { ROLE_LABEL } from './ui';

/** Sigla (o nome) del reparto, tinta dalla rampa corrispondente. */
@Component({
  selector: 'app-role-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="role-chip" [class.is-long]="long()" [class]="'role-' + role()">{{
    text()
  }}</span>`,
})
export class RoleChip {
  readonly role = input.required<Role>();
  readonly long = input(false);

  protected readonly text = computed(() => (this.long() ? ROLE_LABEL[this.role()] : this.role()));
}

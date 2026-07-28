import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { AdminControlTab } from './admin-control-tab';
import { AdminLeagueTab } from './admin-league-tab';
import { AdminPlayersTab } from './admin-players-tab';
import { AdminRulesTab } from './admin-rules-tab';

type Tab = 'lega' | 'listone' | 'rules' | 'regia';

interface TabDef {
  key: Tab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'lega', label: 'Lega e partecipanti' },
  { key: 'listone', label: 'Listone' },
  { key: 'rules', label: 'Regole' },
  { key: 'regia', label: 'Regia' },
];

/** Pannello admin. Le tab pesanti sono montate solo quando servono. */
@Component({
  selector: 'app-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminLeagueTab, AdminPlayersTab, AdminRulesTab, AdminControlTab],
  templateUrl: './admin-page.html',
})
export class AdminPage {
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('lega');
}

/**
 * Seed del mock backend — port di `mock/data.mock.js`.
 * Nell'app reale questi dati arrivano da `GET /players` (xlsx importato) e
 * `GET /participants`.
 */

import { AuctionRules, Participant, Player } from '../auction-events';

export const DEFAULT_RULES: AuctionRules = {
  leagueName: 'Lega Bar dello Sport',
  auctionName: 'Asta 2025/26',
  budget: 300,
  rosterSlots: { P: 3, D: 8, C: 8, A: 6 },
  callOrder: 'free', // 'free' | 'fixed' (P → D → C → A)
  bidTimerSeconds: 5,
  startPriceMode: 'fixed', // 'fixed' | 'quotation'
  startPrice: 1,
  // 'none' | 'purchase' | 'quotation' | 'average' — rimborso degli svincoli
  // nel mercato di riparazione
  releaseRefund: 'purchase',
};

export const SEED_PLAYERS: Player[] = [
  { id: 1, name: 'Maignan', team: 'Milan', role: 'P', quotation: 16 },
  { id: 2, name: 'Di Gregorio', team: 'Juventus', role: 'P', quotation: 13 },
  { id: 3, name: 'Meret', team: 'Napoli', role: 'P', quotation: 12 },
  { id: 4, name: 'Svilar', team: 'Roma', role: 'P', quotation: 15 },
  { id: 5, name: 'Carnesecchi', team: 'Atalanta', role: 'P', quotation: 14 },
  { id: 6, name: 'Falcone', team: 'Lecce', role: 'P', quotation: 8 },
  { id: 7, name: 'Bastoni', team: 'Inter', role: 'D', quotation: 20 },
  { id: 8, name: 'Dimarco', team: 'Inter', role: 'D', quotation: 26 },
  { id: 9, name: 'Theo Hernandez', team: 'Milan', role: 'D', quotation: 24 },
  { id: 10, name: 'Dodo', team: 'Fiorentina', role: 'D', quotation: 17 },
  { id: 11, name: 'Di Lorenzo', team: 'Napoli', role: 'D', quotation: 19 },
  { id: 12, name: 'Cambiaso', team: 'Juventus', role: 'D', quotation: 18 },
  { id: 13, name: 'Gatti', team: 'Juventus', role: 'D', quotation: 12 },
  { id: 14, name: 'Buongiorno', team: 'Napoli', role: 'D', quotation: 14 },
  { id: 15, name: 'Bellanova', team: 'Atalanta', role: 'D', quotation: 16 },
  { id: 16, name: 'Angelino', team: 'Roma', role: 'D', quotation: 15 },
  { id: 17, name: 'Barella', team: 'Inter', role: 'C', quotation: 28 },
  { id: 18, name: 'Pulisic', team: 'Milan', role: 'C', quotation: 38 },
  { id: 19, name: 'Koopmeiners', team: 'Juventus', role: 'C', quotation: 30 },
  { id: 20, name: 'Zaccagni', team: 'Lazio', role: 'C', quotation: 27 },
  { id: 21, name: 'Orsolini', team: 'Bologna', role: 'C', quotation: 29 },
  { id: 22, name: 'McTominay', team: 'Napoli', role: 'C', quotation: 32 },
  { id: 23, name: 'Soulé', team: 'Roma', role: 'C', quotation: 22 },
  { id: 24, name: 'Frattesi', team: 'Inter', role: 'C', quotation: 16 },
  { id: 25, name: 'Fagioli', team: 'Fiorentina', role: 'C', quotation: 13 },
  { id: 26, name: 'Ferguson', team: 'Bologna', role: 'C', quotation: 15 },
  { id: 27, name: 'Lautaro Martinez', team: 'Inter', role: 'A', quotation: 62 },
  { id: 28, name: 'Dybala', team: 'Roma', role: 'A', quotation: 45 },
  { id: 29, name: 'Vlahovic', team: 'Juventus', role: 'A', quotation: 48 },
  { id: 30, name: 'Lukaku', team: 'Napoli', role: 'A', quotation: 52 },
  { id: 31, name: 'Thuram', team: 'Inter', role: 'A', quotation: 50 },
  { id: 32, name: 'Retegui', team: 'Atalanta', role: 'A', quotation: 44 },
  { id: 33, name: 'Kean', team: 'Fiorentina', role: 'A', quotation: 30 },
  { id: 34, name: 'Castellanos', team: 'Lazio', role: 'A', quotation: 26 },
  { id: 35, name: 'Leao', team: 'Milan', role: 'A', quotation: 47 },
  { id: 36, name: 'Zirkzee', team: 'Como', role: 'A', quotation: 21 },
];

/**
 * Colori squadra della palette Prato. Sono **fondi** di avatar con le iniziali
 * scritte in `--color-bg`, quindi vanno tenuti chiari e saturi: qui il rapporto
 * di contrasto col testo scuro sta fra 5.8 e 12.8. In produzione i colori li
 * assegna il backend (`rules/league.util.teamColor`), questi valgono solo per il
 * mock offline.
 */
const SEED: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Ciccio', 'Ajax Bagnoschiuma', '7KQ2MX', '#b4e84f'],
  ['Marco', 'Bayer Neverlusen', 'P4WZ9A', '#ffd447'],
  ['Giulia', 'Deportivo La Sosta', 'B3HN6T', '#5ad1ff'],
  ['Ste', 'Manchester Sciupity', 'R8VJ2C', '#ff6b4a'],
  ['Fede', 'Real Poltrona', 'L5DY7F', '#cbf080'],
  ['Ale', 'Atletico Ritardo', 'M9XK3S', '#ffe083'],
  ['Vale', 'Panchina Lunga FC', 'T6QW8N', '#bfdcc2'],
  ['Dario', 'Zona Cesarini', 'Z2FP5H', '#7ca98c'],
];

export const SEED_PARTICIPANTS: Participant[] = SEED.map(
  ([name, teamName, accessCode, color], i) => ({
    id: `p${i + 1}`,
    name,
    teamName,
    accessCode,
    // Nel mock il magic token è leggibile apposta: serve a provare `/j/<token>`
    // a mano. Sul server è 32 caratteri casuali.
    magicToken: `mock-link-${accessCode.toLowerCase()}`,
    avatarUrl: null,
    color,
    budget: DEFAULT_RULES.budget,
    spent: 0,
    roster: [],
    online: i !== 6,
  }),
);

export const ADMIN_TOKEN = 'ADMIN-2026';

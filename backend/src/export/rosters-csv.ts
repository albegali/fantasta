/**
 * Formato CSV delle rose per il **caricamento su Fantacalcio.it**.
 *
 * Tre colonne senza intestazione — `nomeSquadra,idCalciatore,prezzo` — e una riga
 * separatore `$,$,$` **prima** di ogni blocco-squadra, incluso il primo.
 * `idCalciatore` è l'`Id` del listone Fantacalcio.it, cioè `Player.externalId`:
 * il nostro id interno (`Player.id`) per loro non significa niente.
 *
 * File di riferimento: `resources/fanta-asta-live-rosters-1785180073624.csv`.
 */

/** Riga che separa un blocco-squadra dal successivo. */
export const BLOCK_SEPARATOR = '$,$,$';

export interface CsvRosterEntry {
  /** `Id` del listone Fantacalcio.it; `null` per chi non è mai passato dall'import. */
  externalId: number | null;
  name: string;
  realTeam: string;
  price: number;
}

export interface CsvTeam {
  teamName: string;
  roster: CsvRosterEntry[];
}

/** Acquisto rimasto fuori dal file: senza `externalId` non è importabile. */
export interface SkippedPlayer {
  teamName: string;
  name: string;
  realTeam: string;
  price: number;
}

export interface RostersCsv {
  csv: string;
  skipped: SkippedPlayer[];
}

/**
 * Il separatore `$,$,$` tradisce un parser che spacca sulle virgole senza gestire
 * le virgolette: un `teamName` con una virgola sfaserebbe le colonne di tutto il
 * blocco. Meglio ripulire il nome che produrre un file letto storto.
 */
function csvSafe(value: string): string {
  return value
    .replace(/["\r\n]/g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRostersCsv(teams: CsvTeam[]): RostersCsv {
  const lines: string[] = [];
  const skipped: SkippedPlayer[] = [];

  for (const team of teams) {
    // Il separatore esce anche per una squadra a rosa vuota: il file resta 1:1
    // con la lega, e un export a metà asta è un caso previsto (lo è pure il
    // file d'esempio, con 2-3 acquisti a squadra).
    lines.push(BLOCK_SEPARATOR);
    const teamName = csvSafe(team.teamName) || 'Squadra';
    const roster = [...team.roster].sort(
      (a, b) => a.price - b.price || a.name.localeCompare(b.name),
    );
    for (const entry of roster) {
      if (entry.externalId == null) {
        skipped.push({
          teamName: team.teamName,
          name: entry.name,
          realTeam: entry.realTeam,
          price: entry.price,
        });
        continue;
      }
      lines.push(`${teamName},${entry.externalId},${entry.price}`);
    }
  }

  return { csv: lines.length ? `${lines.join('\n')}\n` : '', skipped };
}

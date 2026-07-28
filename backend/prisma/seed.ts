/**
 * Seed di sviluppo. Crea la lega di default, le otto squadre della demo (con gli
 * stessi codici d'accesso documentati in `frontend/README.md`) e un mini-listone,
 * così l'asta è giocabile subito senza avere sotto mano l'xlsx di Fantacalcio.it.
 *
 * Idempotente: se la lega esiste già non tocca niente. In produzione il listone
 * vero arriva da `POST /players/import`.
 */
import { AuctionStatus, CallOrder, PrismaClient, Role, StartPriceMode } from '@prisma/client';
import { randomMagicToken } from '../src/rules/league.util';

const prisma = new PrismaClient();

const TEAMS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Ciccio', 'Ajax Bagnoschiuma', '7KQ2MX', '#b5abfc'],
  ['Marco', 'Bayer Neverlusen', 'P4WZ9A', '#9397ab'],
  ['Giulia', 'Deportivo La Sosta', 'B3HN6T', '#a7a1db'],
  ['Ste', 'Manchester Sciupity', 'R8VJ2C', '#cfd3e5'],
  ['Fede', 'Real Poltrona', 'L5DY7F', '#968ae0'],
  ['Ale', 'Atletico Ritardo', 'M9XK3S', '#b2b6ca'],
  ['Vale', 'Panchina Lunga FC', 'T6QW8N', '#d2cefd'],
  ['Dario', 'Zona Cesarini', 'Z2FP5H', '#7972a9'],
];

const PLAYERS: ReadonlyArray<readonly [string, string, Role, number]> = [
  ['Maignan', 'Milan', Role.P, 16],
  ['Di Gregorio', 'Juventus', Role.P, 13],
  ['Meret', 'Napoli', Role.P, 12],
  ['Svilar', 'Roma', Role.P, 15],
  ['Carnesecchi', 'Atalanta', Role.P, 14],
  ['Falcone', 'Lecce', Role.P, 8],
  ['Di Gregorio II', 'Como', Role.P, 6],
  ['Sportiello', 'Milan', Role.P, 5],
  ['Bastoni', 'Inter', Role.D, 20],
  ['Dimarco', 'Inter', Role.D, 26],
  ['Theo Hernandez', 'Milan', Role.D, 24],
  ['Dodo', 'Fiorentina', Role.D, 17],
  ['Di Lorenzo', 'Napoli', Role.D, 19],
  ['Cambiaso', 'Juventus', Role.D, 18],
  ['Gatti', 'Juventus', Role.D, 12],
  ['Buongiorno', 'Napoli', Role.D, 14],
  ['Bellanova', 'Atalanta', Role.D, 16],
  ['Angelino', 'Roma', Role.D, 15],
  ['Bijol', 'Udinese', Role.D, 11],
  ['Baschirotto', 'Lecce', Role.D, 9],
  ['Barella', 'Inter', Role.C, 28],
  ['Pulisic', 'Milan', Role.C, 38],
  ['Koopmeiners', 'Juventus', Role.C, 30],
  ['Zaccagni', 'Lazio', Role.C, 27],
  ['Orsolini', 'Bologna', Role.C, 29],
  ['McTominay', 'Napoli', Role.C, 32],
  ['Soulé', 'Roma', Role.C, 22],
  ['Frattesi', 'Inter', Role.C, 16],
  ['Fagioli', 'Fiorentina', Role.C, 13],
  ['Ferguson', 'Bologna', Role.C, 15],
  ['Loftus-Cheek', 'Milan', Role.C, 14],
  ['Pellegrini', 'Roma', Role.C, 18],
  ['Lautaro Martinez', 'Inter', Role.A, 62],
  ['Dybala', 'Roma', Role.A, 45],
  ['Vlahovic', 'Juventus', Role.A, 48],
  ['Lukaku', 'Napoli', Role.A, 52],
  ['Thuram', 'Inter', Role.A, 50],
  ['Retegui', 'Atalanta', Role.A, 44],
  ['Kean', 'Fiorentina', Role.A, 30],
  ['Castellanos', 'Lazio', Role.A, 26],
  ['Leao', 'Milan', Role.A, 47],
  ['Zirkzee', 'Como', Role.A, 21],
  ['Krstovic', 'Lecce', Role.A, 19],
  ['Piccoli', 'Cagliari', Role.A, 17],
];

async function main(): Promise<void> {
  const existing = await prisma.league.findFirst();
  if (existing) {
    console.log('League già presente, skip seed.');
    return;
  }

  const league = await prisma.league.create({
    data: {
      leagueName: 'Lega Bar dello Sport',
      auctionName: 'Asta 2025/26',
      budget: 300,
      slotsP: 3,
      slotsD: 8,
      slotsC: 8,
      slotsA: 6,
      callOrder: CallOrder.fixed,
      bidTimerSeconds: 5,
      startPriceMode: StartPriceMode.fixed,
      startPrice: 1,
      status: AuctionStatus.IDLE,
    },
  });

  for (const [name, teamName, accessCode, color] of TEAMS) {
    await prisma.participant.create({
      data: {
        leagueId: league.id,
        name,
        teamName,
        accessCode,
        // Il magic link non è documentato come i codici: è casuale a ogni seed e
        // l'admin lo copia dalla tab Lega.
        magicToken: randomMagicToken(),
        color,
        budget: league.budget,
      },
    });
  }
  const participants = await prisma.participant.findMany({
    where: { leagueId: league.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  await prisma.league.update({
    where: { id: league.id },
    data: { turnOrder: participants.map((p) => p.id) },
  });

  if ((await prisma.player.count()) === 0) {
    await prisma.player.createMany({
      data: PLAYERS.map(([name, realTeam, role, quotation]) => ({
        name,
        realTeam,
        role,
        quotation,
      })),
    });
  }

  console.log(
    `Seed creato: lega ${league.id}, ${TEAMS.length} squadre, ${PLAYERS.length} calciatori.`,
  );
  console.log(`Codici: ${TEAMS.map(([, , code]) => code).join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

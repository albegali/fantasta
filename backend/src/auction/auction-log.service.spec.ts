import { AuctionLogType as DbLogType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionLogService, LogDraft } from './auction-log.service';
import { LOG_TAIL } from './dto/events';

const LEAGUE = 'league-1';

interface Row {
  leagueId: string;
  seq: number;
  type: DbLogType;
  at: Date;
  participantId: string | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  role: null;
  price: number | null;
  detail: string | null;
}

/**
 * Prisma finto: tiene le righe in un array e registra l'**ordine** delle
 * operazioni. La coda di scrittura è il cuore di questo servizio, quindi è
 * proprio l'ordine che va verificato.
 */
function fakePrisma() {
  const rows: Row[] = [];
  const calls: string[] = [];
  let failNext = false;
  const api = {
    rows,
    calls,
    breakNextWrite: () => {
      failNext = true;
    },
    auctionLogEntry: {
      create: ({ data }: { data: Row }) => {
        calls.push(`create:${data.seq}`);
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('DB offline'));
        }
        rows.push(data);
        return Promise.resolve(data);
      },
      deleteMany: ({ where }: { where: { leagueId: string } }) => {
        calls.push('deleteMany');
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].leagueId === where.leagueId) rows.splice(i, 1);
        }
        return Promise.resolve({ count: before - rows.length });
      },
      findMany: (args: {
        where: { leagueId: string; seq?: { lt: number }; type?: { in: DbLogType[] } };
        take: number;
      }) => {
        calls.push('findMany');
        const found = rows
          .filter(
            (r) =>
              r.leagueId === args.where.leagueId &&
              (args.where.seq === undefined || r.seq < args.where.seq.lt) &&
              (args.where.type === undefined || args.where.type.in.includes(r.type)),
          )
          .sort((a, b) => b.seq - a.seq)
          .slice(0, args.take);
        return Promise.resolve(found);
      },
    },
  };
  return api;
}

const draft = (overrides: Partial<LogDraft> = {}): LogDraft => ({
  type: 'bid',
  participantId: 'p1',
  teamName: 'FC Test',
  playerId: 7,
  playerName: 'Rossi',
  role: null,
  price: 12,
  detail: null,
  ...overrides,
});

function build() {
  const prisma = fakePrisma();
  // Il servizio usa solo `auctionLogEntry`: il resto di PrismaService non serve.
  const logs = new AuctionLogService(prisma as unknown as PrismaService);
  return { prisma, logs };
}

describe('AuctionLogService', () => {
  it('numera le righe e tiene la più recente in testa', () => {
    const { logs } = build();
    logs.append(LEAGUE, draft({ type: 'nominate', price: 1 }));
    const tail = logs.append(LEAGUE, draft({ price: 2 }));

    expect(tail.map((e) => e.seq)).toEqual([2, 1]);
    expect(tail[0]).toMatchObject({ type: 'bid', price: 2, teamName: 'FC Test' });
    expect(tail[0].at).toBeGreaterThan(0);
  });

  it('nello snapshot tiene solo la coda recente', () => {
    const { logs } = build();
    for (let i = 0; i < LOG_TAIL + 5; i += 1) logs.append(LEAGUE, draft());

    const tail = logs.tail();
    expect(tail).toHaveLength(LOG_TAIL);
    expect(tail[0].seq).toBe(LOG_TAIL + 5);
    expect(tail.at(-1)!.seq).toBe(6);
  });

  it('non aspetta il DB: la riga è nella coda prima della scrittura', async () => {
    const { prisma, logs } = build();
    logs.append(LEAGUE, draft());

    expect(logs.tail()).toHaveLength(1);
    expect(prisma.rows).toHaveLength(0); // ancora niente sul DB
    await logs.flush();
    expect(prisma.rows).toHaveLength(1);
  });

  it('scrive nell’ordine in cui i fatti sono successi', async () => {
    const { prisma, logs } = build();
    logs.append(LEAGUE, draft({ type: 'nominate' }));
    logs.append(LEAGUE, draft());
    logs.append(LEAGUE, draft({ type: 'assigned' }));
    await logs.flush();

    expect(prisma.calls).toEqual(['create:1', 'create:2', 'create:3']);
    expect(prisma.rows.map((r) => r.type)).toEqual(['NOMINATE', 'BID', 'ASSIGNED']);
  });

  it('una scrittura fallita costa una riga di cronaca, non l’asta', async () => {
    const { prisma, logs } = build();
    prisma.breakNextWrite();
    expect(() => logs.append(LEAGUE, draft())).not.toThrow();
    logs.append(LEAGUE, draft({ price: 3 }));
    await expect(logs.flush()).resolves.toBeUndefined();

    expect(prisma.rows.map((r) => r.seq)).toEqual([2]); // la seconda passa comunque
    expect(logs.tail()).toHaveLength(2); // in memoria la cronaca è completa
  });

  it('azzera dopo le scritture in volo, non prima', async () => {
    const { prisma, logs } = build();
    logs.append(LEAGUE, draft());
    logs.append(LEAGUE, draft());
    await logs.clear(LEAGUE);

    // La cancellazione entra in coda DOPO gli insert: nessuna riga sopravvive al reset.
    expect(prisma.calls).toEqual(['create:1', 'create:2', 'deleteMany']);
    expect(prisma.rows).toHaveLength(0);
    expect(logs.tail()).toEqual([]);
  });

  it('dopo l’azzeramento la numerazione riparte da 1', async () => {
    const { prisma, logs } = build();
    logs.append(LEAGUE, draft());
    await logs.clear(LEAGUE);
    const tail = logs.append(LEAGUE, draft({ type: 'reset' }));
    await logs.flush();

    expect(tail.map((e) => e.seq)).toEqual([1]);
    expect(prisma.rows.map((r) => r.seq)).toEqual([1]); // nessuna collisione su (leagueId, seq)
  });

  it('al boot riprende la numerazione dal DB', async () => {
    const { prisma, logs } = build();
    logs.append(LEAGUE, draft());
    logs.append(LEAGUE, draft());
    await logs.flush();

    const restarted = new AuctionLogService(prisma as unknown as PrismaService);
    const tail = await restarted.load(LEAGUE);
    expect(tail.map((e) => e.seq)).toEqual([2, 1]);

    restarted.append(LEAGUE, draft({ type: 'assigned' }));
    await restarted.flush();
    expect(prisma.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('la storia si legge a pagine e per tipo', async () => {
    const { logs } = build();
    logs.append(LEAGUE, draft({ type: 'nominate' })); // 1
    logs.append(LEAGUE, draft()); // 2
    logs.append(LEAGUE, draft({ type: 'assigned' })); // 3
    logs.append(LEAGUE, draft({ type: 'claim' })); // 4
    await logs.flush();

    const page = await logs.list(LEAGUE, { take: 2 });
    expect(page.map((e) => e.seq)).toEqual([4, 3]);

    const older = await logs.list(LEAGUE, { before: page.at(-1)!.seq });
    expect(older.map((e) => e.seq)).toEqual([2, 1]);

    const purchases = await logs.list(LEAGUE, { types: ['assigned', 'claim'] });
    expect(purchases.map((e) => e.type)).toEqual(['claim', 'assigned']);
  });
});

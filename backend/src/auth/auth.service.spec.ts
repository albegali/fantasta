import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, SESSION_TTL_DAYS } from './auth.service';

const SECRET = 'segreto-di-test';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  teamName: string;
  accessCode: string;
  magicToken: string;
  tokenVersion: number;
}

const CICCIO: Row = {
  id: 'p1',
  teamName: 'Ajax Bagnoschiuma',
  accessCode: '7KQ2MX',
  magicToken: 'M1NfaSaMPLEt0kenBASE64url32ch',
  tokenVersion: 0,
};

/**
 * Prisma finto: due sole letture, per id e per credenziale. Quel che conta qui è
 * *quale* credenziale risolve chi, non come Prisma costruisce la query.
 */
function fakePrisma(rows: Row[]) {
  return {
    participant: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      findFirst: ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const [{ magicToken }, { accessCode }] = where.OR as [
          { magicToken: string },
          { accessCode: string },
        ];
        return Promise.resolve(
          rows.find((r) => r.magicToken === magicToken || r.accessCode === accessCode) ?? null,
        );
      },
    },
  } as unknown as PrismaService;
}

function makeAuth(rows: Row[] = [CICCIO], jwt = new JwtService({ secret: SECRET })) {
  return new AuthService(fakePrisma(rows), jwt);
}

/** Il JWT firmato dal server, come lo terrebbe il client in `localStorage`. */
async function sessionFor(auth: AuthService, credential: string): Promise<string> {
  const outcome = await auth.resolve(credential);
  if (outcome.kind !== 'ok' || !outcome.session) throw new Error('nessuna sessione emessa');
  return outcome.session.token;
}

describe('AuthService', () => {
  describe('credenziali', () => {
    it('il magic token del link identifica la squadra ed emette una sessione', async () => {
      const outcome = await makeAuth().resolve(CICCIO.magicToken);
      expect(outcome).toMatchObject({ kind: 'ok', participantId: 'p1' });
      expect(outcome.kind === 'ok' && outcome.session?.token).toBeTruthy();
    });

    it('il codice a 6 caratteri resta un fallback valido, anche minuscolo', async () => {
      const outcome = await makeAuth().resolve('7kq2mx');
      expect(outcome).toMatchObject({ kind: 'ok', participantId: 'p1' });
    });

    it('la scadenza dichiarata è quella del JWT', async () => {
      const outcome = await makeAuth().resolve(CICCIO.magicToken);
      const expiresAt = outcome.kind === 'ok' ? (outcome.session?.expiresAt ?? 0) : 0;
      expect(expiresAt).toBeGreaterThan(Date.now() + (SESSION_TTL_DAYS - 1) * DAY_MS);
    });

    it('una credenziale sconosciuta non risolve nessuno', async () => {
      expect(await makeAuth().resolve('NONESISTE')).toEqual({ kind: 'unknown' });
      expect(await makeAuth().resolve('   ')).toEqual({ kind: 'unknown' });
    });
  });

  describe('sessione', () => {
    it('il JWT emesso rientra in sala senza il link', async () => {
      const auth = makeAuth();
      const token = await sessionFor(auth, CICCIO.magicToken);
      expect(await auth.resolve(token)).toMatchObject({ kind: 'ok', participantId: 'p1' });
    });

    it('non rinnova una sessione ancora giovane', async () => {
      const auth = makeAuth();
      const token = await sessionFor(auth, CICCIO.magicToken);
      const again = await auth.resolve(token);
      expect(again.kind === 'ok' && again.session).toBeNull();
    });

    it('rinnova quando è passata più di metà vita (finestra scorrevole)', async () => {
      const auth = makeAuth();
      const token = await sessionFor(auth, CICCIO.magicToken);
      const overHalf = Date.now() + (SESSION_TTL_DAYS / 2 + 1) * DAY_MS;
      jest.spyOn(Date, 'now').mockReturnValue(overHalf);
      try {
        const again = await auth.resolve(token);
        expect(again.kind === 'ok' && again.session?.token).toBeTruthy();
      } finally {
        jest.spyOn(Date, 'now').mockRestore();
      }
    });

    it('un JWT firmato con un altro segreto è carta straccia', async () => {
      const impostor = new JwtService({
        secret: 'un-altro-segreto',
        signOptions: { expiresIn: '30d' },
      });
      const forged = await impostor.signAsync({ sub: 'p1', ver: 0 });
      expect(await makeAuth().resolve(forged)).toEqual({ kind: 'expired' });
    });

    it('un JWT scaduto non vale', async () => {
      const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '-1s' } });
      const stale = await jwt.signAsync({ sub: 'p1', ver: 0 });
      expect(await makeAuth([CICCIO], jwt).resolve(stale)).toEqual({ kind: 'expired' });
    });
  });

  describe('revoca', () => {
    it('rigenerare una credenziale (tokenVersion++) invalida le sessioni aperte', async () => {
      const rows = [{ ...CICCIO }];
      const auth = makeAuth(rows);
      const token = await sessionFor(auth, CICCIO.magicToken);

      rows[0].tokenVersion += 1; // l'admin ha rigenerato codice o link
      expect(await auth.resolve(token)).toEqual({ kind: 'expired' });
    });

    it('una squadra cancellata non rientra con la sua vecchia sessione', async () => {
      const rows = [{ ...CICCIO }];
      const auth = makeAuth(rows);
      const token = await sessionFor(auth, CICCIO.magicToken);

      rows.pop();
      expect(await auth.resolve(token)).toEqual({ kind: 'expired' });
    });
  });
});

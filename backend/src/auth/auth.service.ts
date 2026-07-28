import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionToken } from '../auction/dto/events';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quanto vale un JWT di sessione. Il **link** è durevole (deve funzionare la sera
 * dell'asta e a gennaio nel mercato di riparazione); la **sessione** no: è quel
 * che resta sul telefono, e se il telefono gira deve scadere da sola.
 */
export const SESSION_TTL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finestra scorrevole: sotto metà vita residua l'ack porta una sessione nuova.
 * Chi entra in sala ogni tanto non si vede scadere la sessione sotto il naso;
 * chi sparisce per un mese rientra dal link.
 */
const REFRESH_BELOW_MS = (SESSION_TTL_DAYS / 2) * DAY_MS;

/** Claim del JWT: l'identità e la generazione delle credenziali, nient'altro. */
interface SessionClaims {
  /** `Participant.id`. */
  sub: string;
  /** `Participant.tokenVersion` al momento dell'emissione: è la revoca. */
  ver: number;
  /** Scadenza in secondi, la mette `JwtService`. */
  exp: number;
}

/**
 * Esito di un tentativo d'identificazione.
 * - `ok` → chi è, e la sessione da salvare (`null` se quella in mano vale ancora);
 * - `expired` → sessione scaduta o revocata: il client la butta e rientra dal link;
 * - `unknown` → credenziale che non risolve nessuno.
 */
export type AuthOutcome =
  | { kind: 'ok'; participantId: string; teamName: string; session: SessionToken | null }
  | { kind: 'expired' }
  | { kind: 'unknown' };

/**
 * Identifica i partecipanti. Tre credenziali, una sola porta:
 *
 * 1. **JWT di sessione** — quel che il client ha in `localStorage`, rinnovato a
 *    finestra scorrevole. È il caso normale dopo il primo ingresso.
 * 2. **Magic token** — la credenziale dentro `/j/<token>`, durevole e revocabile
 *    rigenerandola.
 * 3. **Codice a 6 caratteri** — il fallback che si detta a voce a chi ha perso il
 *    link (PLAN.md, decisione 7).
 *
 * Il token d'admin non passa di qui: resta `ADMIN_TOKEN` (`admin.guard.ts`), che è
 * anche la credenziale delle rotte REST.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async resolve(token: string): Promise<AuthOutcome> {
    const raw = token.trim();
    if (!raw) return { kind: 'unknown' };
    return looksLikeJwt(raw) ? this.resume(raw) : this.fromCredential(raw);
  }

  /** Sessione in mano al client: si verifica la firma, poi la generazione. */
  private async resume(jwt: string): Promise<AuthOutcome> {
    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(jwt);
    } catch {
      return { kind: 'expired' }; // scaduta, manomessa o firmata con un altro segreto
    }

    const participant = await this.prisma.participant.findUnique({
      where: { id: claims.sub },
      select: { id: true, teamName: true, tokenVersion: true },
    });
    // Squadra cancellata, oppure codice/link rigenerati dopo l'emissione.
    if (!participant || participant.tokenVersion !== claims.ver) return { kind: 'expired' };

    const expiresAt = claims.exp * 1000;
    return {
      kind: 'ok',
      participantId: participant.id,
      teamName: participant.teamName,
      session:
        expiresAt - Date.now() < REFRESH_BELOW_MS
          ? await this.issue(participant.id, participant.tokenVersion)
          : null,
    };
  }

  /** Magic token dal link, oppure codice a 6 caratteri dettato a voce. */
  private async fromCredential(credential: string): Promise<AuthOutcome> {
    const participant = await this.prisma.participant.findFirst({
      where: {
        OR: [{ magicToken: credential }, { accessCode: credential.toUpperCase() }],
      },
      select: { id: true, teamName: true, tokenVersion: true },
    });
    if (!participant) return { kind: 'unknown' };
    return {
      kind: 'ok',
      participantId: participant.id,
      teamName: participant.teamName,
      session: await this.issue(participant.id, participant.tokenVersion),
    };
  }

  /**
   * La scadenza la mette qui, non nella configurazione del `JwtModule`: la firma e
   * il `expiresAt` dichiarato nell'ack devono venire dalla **stessa** costante,
   * altrimenti un JWT senza `exp` passerebbe la verifica e non scadrebbe mai.
   */
  private async issue(participantId: string, tokenVersion: number): Promise<SessionToken> {
    const token = await this.jwt.signAsync(
      { sub: participantId, ver: tokenVersion },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
    return { token, expiresAt: Date.now() + SESSION_TTL_DAYS * DAY_MS };
  }
}

/**
 * Un JWT compatto ha tre parti separate da punto; né i magic token (base64url,
 * niente punti) né i codici a 6 caratteri ne hanno. Serve solo a scegliere quale
 * strada tentare: a decidere se vale è la firma.
 */
function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

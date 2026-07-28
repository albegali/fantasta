# AGENTS.md

> Istruzioni operative per agenti di coding (Claude Code, ecc.). Formato compatibile
> con la convenzione `AGENTS.md`. Il contesto di dominio è in [`CLAUDE.md`](./CLAUDE.md).

## Setup

```bash
# Requisiti: Node.js >= 20 LTS, npm >= 10, Docker (per Postgres locale)
docker compose up -d db       # (dalla root) avvia Postgres su :5432
cd backend
cp .env.example .env          # poi valorizza DATABASE_URL, ADMIN_TOKEN, JWT_SECRET
npm install
npx prisma migrate dev        # applica le migrazioni (genera anche il client)
npm run seed                  # lega + 8 squadre demo + mini-listone (idempotente)
npm run start:dev
```

Frontend (già importato da Claude Design — vedi `frontend/README.md`):
```bash
cd frontend && npm install && npm start   # parla col backend su :3000
```

Il frontend parte contro il **gateway reale** (`environment.useMock: false`). Per lavorare
sulla UI senza backend: `useMock: true` → mock in-memory con avversari simulati.
Il token d'admin da inserire all'accesso è l'`ADMIN_TOKEN` del backend. I partecipanti entrano
dal **magic link** che l'admin copia dalla tab Lega; il codice a 6 caratteri resta il fallback.
Entrambi li crea il seed (o `POST /participants`).

`JWT_SECRET` non è opzionale: firma le sessioni dei partecipanti e senza il backend non parte.

## Build / Test / Lint

| Azione        | `backend/`             | `frontend/`        |
|---------------|------------------------|--------------------|
| Dev server    | `npm run start:dev`    | `npm start`        |
| Build         | `npm run build`        | `npm run build`    |
| Test unit     | `npm test`             | `npm test`         |
| Test e2e      | `npm run test:e2e`     | —                  |
| Lint          | `npm run lint`         | —                  |
| Format        | `npm run format`       | `npm run format`   |
| Prisma studio | `npx prisma studio`    | —                  |

**Prima di aprire un PR** eseguire, nel package toccato: `npm run lint && npm test && npm run build`.

## Convenzioni di codice

- **TypeScript strict**; niente `any` senza commento che ne spieghi il motivo.
- NestJS: un **module per dominio** (`players`, `participants`, `rules`, `auction`, `auth`).
  L'identità dei partecipanti la risolve `auth/auth.service.ts` — magic link, sessione JWT,
  codice a 6 — e il gateway fa solo trasporto.
  Controller sottili, logica nei service, regole d'asta isolate in `auction/auction-engine.ts` (funzioni pure e testabili).
- **Direzione delle dipendenze**: i moduli REST (`rules`, `players`, `participants`) importano
  `AuctionModule` e notificano lo stato live (`auction.refresh()`); l'asta **non** importa loro
  (sarebbe un ciclo). Quel che serve a entrambi sta in helper puri (`rules/league.util.ts`,
  `players/player.view.ts`).
- DTO REST validati con `class-validator` + `ValidationPipe` globale. Sui **payload socket** la
  forma si valida in `auction/dto/parse.ts`: sul gateway il `ValidationPipe` emetterebbe una
  `WsException` su un canale che il client non ascolta, mentre ogni rifiuto deve uscire come
  `errorMsg` + ack negativo.
- Tipi dei payload socket **condivisi** in `auction/dto/events.ts` (unica fonte di verità del contratto).
- Naming: file `kebab-case`, classi `PascalCase`, variabili/funzioni `camelCase`.
- Commit: **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Branch: `feat/<fase>-<slug>` (es. `feat/03-auction-engine`).

## Regole specifiche del progetto (NON derogabili)

1. **Il server è authoritative.** Nessuna decisione di budget/asta/turni nel frontend.
2. **Timer sul server.** I client ricevono `endsAt` assoluto + `tick` indicativi. Mai fidarsi del clock del client per chiudere un lotto.
3. **Validare ogni evento socket** (autenticazione + DTO + regole di dominio) prima di mutare lo stato.
4. **Concorrenza**: le mutazioni di stato d'asta passano da un singolo punto serializzato (una coda/lock per `auctionId`) per evitare race sui rilanci.
5. **Soldi = interi.** I crediti sono numeri interi. Niente floating point.
6. **Segreti** solo via env; mai committare `.env`, token, chiavi.

## Confini per gli agenti (chi tocca cosa)

- `frontend/` è **di norma read-only** per gli agenti backend: è generato con Claude Design.
  Modificarlo solo se esplicitamente richiesto, e solo per allinearsi al contratto socket/REST.
- Modifiche allo **schema DB** → sempre via `prisma migrate` (mai editare a mano le migrazioni applicate).
- Modifiche al **contratto socket** → aggiornare in un unico PR: `dto/events.ts`, sezione 5 di `CLAUDE.md`, `frontend/README.md`.

## Definition of Done (per ogni task/fase di PLAN.md)

- [ ] Codice tipizzato, lint e build verdi.
- [ ] Test per la logica non banale (in particolare `auction-engine`).
- [ ] Contratto socket/REST aggiornato se cambiato.
- [ ] `PLAN.md` aggiornato (checkbox spuntata, decisioni annotate).
- [ ] Nessun segreto o dato reale committato.

## Cosa fare in caso di ambiguità

Non inventare regole di gioco o campi del file Fantacalcio.it. Aggiungere una voce in
`PLAN.md → Decisioni aperte`, proporre un default ragionevole e proseguire segnalandolo
nel PR.

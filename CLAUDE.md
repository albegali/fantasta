# CLAUDE.md

> Contesto di progetto per Claude Code / agenti AI. Leggere **sempre** questo file
> prima di lavorare sul repo. Le regole operative (setup, build, test, stile, PR)
> sono in [`AGENTS.md`](./AGENTS.md); la roadmap in [`PLAN.md`](./PLAN.md);
> il deploy in [`INFRA.md`](./INFRA.md).

## 1. Cos'è questo progetto

**Fantasta Auction** è una mobile web app per gestire in tempo reale l'**asta del
fantacalcio** (Serie A). L'admin carica la lista calciatori e i partecipanti,
definisce le regole, e conduce un'asta a turni. Ogni chiamata apre un rilancio a
tempo (default 5s) fra i partecipanti; alla scadenza il giocatore è assegnato al
miglior offerente e crediti/slot vengono aggiornati.

Obiettivo dichiarato: **costo di esercizio ~0** (tier gratuiti), pensata per essere
usata pochi giorni l'anno (serate d'asta), quindi tollera cold-start e spin-down.

## 2. Stack

| Layer      | Tecnologia                                                        |
|------------|-------------------------------------------------------------------|
| Frontend   | **Angular 22** (standalone, signals, zoneless), `socket.io-client`|
| Backend    | **Node.js + NestJS** (TypeScript), `@nestjs/websockets` + Socket.IO |
| ORM/DB     | **Prisma** + **PostgreSQL** (SQLite in dev locale opzionale)      |
| Realtime   | **Socket.IO** (server authoritative)                              |
| Upload     | `multer` + **SheetJS (`xlsx`)** per il parsing dei file Fantacalcio.it |
| Auth admin | Guard con token condiviso (`ADMIN_TOKEN`, header `x-admin-token`) |
| Auth squadre | **Magic link** `/j/<magicToken>` → sessione JWT (`@nestjs/jwt`), codice a 6 caratteri come fallback |

> Il **frontend** viene generato separatamente con **Claude Design** e importato in
> `frontend/`. Vedi `frontend/README.md` per il contratto d'integrazione (REST + eventi socket).
> Non ricreare da zero il frontend se la cartella è già popolata: integrarsi con lo stato esistente.

## 3. Struttura del repo

```
fantasta-auction/
├── CLAUDE.md            # questo file
├── AGENTS.md            # regole operative per agenti
├── PLAN.md              # roadmap a fasi con checklist
├── INFRA.md             # deploy zero-cost + realtime
├── docker-compose.yml   # Postgres locale
├── backend/             # NestJS API + gateway Socket.IO
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/      # generate con `prisma migrate dev`, non editare a mano
│   │   └── seed.ts          # lega + 8 squadre demo + mini-listone (idempotente)
│   └── src/
│       ├── players/         # import xlsx, ricerca listone, `player.view.ts`
│       ├── participants/    # CRUD partecipanti + codici d'accesso
│       ├── rules/           # configurazione lega + `league.util.ts` (helper puri)
│       ├── auction/         # motore d'asta + gateway realtime
│       │   ├── auction-engine.ts   # regole PURE (verità del dominio)
│       │   ├── auction.service.ts  # stato live, timer, coda di serializzazione
│       │   ├── auction.gateway.ts  # solo trasporto: auth, rooms, broadcast
│       │   ├── auction-log.service.ts # telecronaca: append-only, scrittura in coda
│       │   ├── log.controller.ts   # `GET /log` (pubblico, paginato)
│       │   ├── auction-error.ts    # rifiuti di dominio → `errorMsg`
│       │   └── dto/                # `events.ts` (contratto) + `parse.ts` (forma payload)
│       ├── auth/            # guard admin + `auth.service.ts` (magic link, sessioni)
│       └── prisma/          # PrismaService
└── frontend/            # Angular 22 (generato con Claude Design)
```

## 4. Dominio: regole dell'asta (fonte di verità)

Queste regole sono **implementate lato server** (`auction/auction-engine.ts`). Il
frontend è "dumb": mostra lo stato e invia intenzioni, ma **non decide** nulla.

- **Rosa di default**: `P:3, D:8, C:8, A:6` → 25 giocatori. Configurabile nelle regole.
- **Budget di default**: `300` crediti per partecipante. Configurabile.
- **Ordine chiamata** (`callOrder`):
  - `fixed`: si acquista per ruolo, in ordine `P → D → C → A`. Un partecipante può
    chiamare solo giocatori del ruolo "corrente" finché lo slot ruolo non è saturo per tutti.
    Il reparto in corso è **di lega, non per-partecipante**: è il primo ruolo in cui almeno
    un partecipante ha ancora uno slot libero (`auction-engine.currentRole`). Chi ha già
    saturato quel reparto **viene saltato** nel giro dei turni finché il reparto non cambia
    (`canTakeTurn`). Lo snapshot `state` porta il reparto in `currentRole`.
  - `free`: si può chiamare qualsiasi ruolo, purché ci sia uno slot libero.
- **Turni**: a rotazione secondo `turnOrder` definito dall'admin. Al proprio turno il
  partecipante **nomina** (chiama) un giocatore al prezzo base di lega.
- **Prezzo base** (`startPriceMode`): `fixed` → sempre `startPrice` crediti (default `1`);
  `quotation` → la quotazione di listone del calciatore. È una **regola di lega**; il
  chiamante può alzarla passando `startPrice` in `nominate`, mai scendere sotto `1`.
- **Rilancio**: gli altri partecipanti rilanciano entro `bidTimerSeconds` (default `5`).
  Offerta = `+1` oppure `+N` (campo numerico). Ogni rilancio **valido resetta il timer**.
- **Chiusura**: timer scaduto senza nuovi rilanci → giocatore assegnato al miglior
  offerente al prezzo corrente. Se nessuno rilancia, va al chiamante al prezzo base.
  Il risultato resta a schermo per `ASSIGNED_HOLD_MS` (2,5s, `status: 'ASSIGNED'`) prima
  che il turno passi al successivo.
- **Vincoli di spesa** (il server rifiuta offerte non valide):
  - Non si può offrire più del budget residuo.
  - Bisogna **conservare almeno 1 credito per ogni slot ancora da riempire** (escluso
    quello che si sta riempiendo). `maxBid = budget - creditiSpesi - (slotResidui - 1)`.
  - Non si può acquistare in un ruolo già saturo.
- **Riapertura di un lotto** (`admin:reopenLot`): un lotto chiuso male (rilancio non visto,
  prezzo sbagliato, contestazione) si riapre **rimborsando il compratore e ribattendo**. Il
  calciatore torna all'asta al **prezzo base di lega**, non al prezzo di vendita: si ribatte
  da zero. La chiamata torna a **chi l'aveva fatta**; se non ha più slot o crediti — o se il
  lotto non era mai stato chiamato (svincoli, assegnazioni manuali) — lo tiene il compratore
  rimborsato. A sala in pausa il lotto si riapre senza far partire il timer: lo rimette in
  moto `admin:resume`. Vietato a lotto aperto (`LOT_OPEN`).
- **Avanzamento forzato del reparto** (solo `callOrder: 'fixed'`): l'admin può chiudere il
  reparto in corso **anche se incompleto** (`admin:advanceRole`). Serve quando restano pochi
  slot che nessuno si contenderebbe. Gli slot rimasti **non tornano all'asta**: finiscono negli
  svincoli. Irreversibile, e vietato a lotto aperto (`LOT_OPEN`).
- **Svincoli finali** (`status: 'FILLING'`): quando non resta nessun reparto da battere ma ci
  sono rose incomplete, l'asta apre gli svincoli. Nessun turno, nessun timer, nessun rilancio:
  ogni partecipante completa la rosa prendendo i rimasti a **1 credito fisso** (`claim`).
  Chi arriva primo se lo prende; il server serializza, quindi il secondo riceve `PLAYER_TAKEN`.
- **Fine asta**: quando tutti i partecipanti hanno la rosa completa (o l'admin la chiude).
- **Mercato di riparazione** (`admin:startRepair`): riapre l'asta a metà stagione sulle rose
  esistenti. Non è un'asta nuova e **non ha un motore suo**: si limita a rimettere buchi nelle
  rose e poi riapre la sala, dopodiché valgono le regole di sopra (reparto in corso, turni,
  svincoli finali, fine asta).
  - Apre una **finestra di svincolo** (`status: 'RELEASING'`): nessun turno, nessun timer,
    nessun lotto. Ogni partecipante taglia dalla **propria** rosa (`release`), e finché la
    finestra è aperta può annullare un taglio (`unrelease`). La chiude `admin:start`, che
    rimette all'asta gli slot liberati; da lì i tagli sono definitivi.
  - **Rimborso dello svincolo** (`releaseRefund`): regola di lega, quattro modi — `none`
    (niente), `purchase` (il prezzo pagato, default), `quotation` (la quotazione **attuale** di
    listone, quindi un re-import la cambia), `average` (media di prezzo e quotazione,
    arrotondata **per difetto**).
  - `extraBudget` è una **ricarica** opzionale di crediti uguale per tutti (0 = si ripara col
    solo residuo). I reparti chiusi in anticipo **si riaprono**: `advanceRole` era una decisione
    dell'asta d'agosto, non deve zavorrare quella di gennaio.
  - **Nessun tetto ai movimenti**: i soli vincoli restano gli slot di rosa e i crediti.
  - Non si può tagliare se dopo il taglio la rosa non sarebbe più **completabile** (serve almeno
    1 credito per ogni slot vuoto). È la stessa riserva di `maxBid`: senza, uno slot resterebbe
    vuoto per sempre e l'asta si pianterebbe in `FILLING`.
  - A finestra aperta i comandi d'asta (`pause`, `skipTurn`, `advanceRole`, `assignManual`,
    `reopenLot`, `startRepair`) sono **rifiutati** con `NOT_IDLE`: non ci sono turni né lotti, ed
    eseguirli chiuderebbe la finestra di nascosto.

> **Invariante dei crediti.** `Participant.creditAdjustment` tiene la somma dei movimenti che
> non sono acquisti d'asta (ricariche di riparazione e differenza fra rimborso e prezzo pagato),
> perché con un rimborso diverso dal prezzo il vecchio `budget + speso = budget di lega` si
> rompe. Quello vero è **`budget = League.budget + creditAdjustment − speso`**, ed è su questo
> che `RulesService.rebalanceBudgets` ricalcola i residui quando cambia il tetto di lega.

> Se una regola è ambigua durante l'implementazione, **non inventare**: aggiungere una
> voce in `PLAN.md` sezione "Decisioni aperte" e proporla al maintainer.

## 5. Contratto realtime (Socket.IO)

Namespace: `/auction`. Il server è **authoritative**: valida ogni evento, mantiene lo
stato e ritrasmette. I timer sono gestiti dal server (i client mostrano solo il countdown).

I tipi vivono in `backend/src/auction/dto/events.ts` e in
`frontend/src/app/core/auction-events.ts`: sono **lo stesso file**, allineato campo per
campo. `playerId` è un **intero** (l'id del listone), `participantId` un cuid.

### Client → Server
Ogni evento risponde con un **ack** `{ ok: true }` oppure `{ ok: false, code, message }`;
i rifiuti arrivano anche come `errorMsg` al solo socket chiamante.

| Evento               | Payload                                  | Chi        |
|----------------------|------------------------------------------|------------|
| `auth`               | `{ token, participantId? }` — token = JWT di sessione, magic token del link, codice squadra a 6 caratteri **oppure** `ADMIN_TOKEN`; ack `{ ok, isAdmin, participantId, session? }` | tutti |
| `nominate`           | `{ playerId, startPrice? }`              | chi è di turno |
| `bid`                | `{ mode: 'plus1' \| 'amount', value? }`  | partecipanti |
| `claim`              | `{ playerId }` — svincolo a 1 credito, solo in `FILLING` | partecipanti |
| `release`            | `{ playerId }` — taglia dalla propria rosa, solo in `RELEASING` | partecipanti |
| `unrelease`          | `{ playerId }` — annulla un proprio taglio, solo in `RELEASING` | partecipanti |
| `admin:start`        | `{}`                                     | admin      |
| `admin:pause`        | `{}` — congela il lotto; `resume` riparte con timer pieno | admin |
| `admin:resume`       | `{}`                                     | admin      |
| `admin:skipTurn`     | `{}` — a lotto aperto lo annulla senza assegnarlo | admin |
| `admin:assignManual` | `{ playerId, participantId, price }` — non vincolato al reparto, ma slot e crediti sì | admin |
| `admin:advanceRole`  | `{}` — chiude il reparto in corso anche se incompleto; se non ne restano, apre gli svincoli | admin |
| `admin:reopenLot`    | `{ playerId }` — rimborsa il compratore e rimette il lotto all'asta al prezzo base | admin |
| `admin:startRepair`  | `{ extraBudget? }` — apre il mercato di riparazione: finestra di svincolo + ricarica di crediti. La chiude `admin:start` | admin |

### Server → Client
| Evento           | Payload                                                        |
|------------------|----------------------------------------------------------------|
| `state`          | snapshot completo (`AuctionState`) — **unica** fonte di stato per il client |
| `turn`           | `{ participantId }` — di chi è il turno                        |
| `nominated`      | `{ player, byParticipantId, price, endsAt }` — asta aperta     |
| `bid`            | `{ participantId, price, endsAt }` — nuovo miglior offerente   |
| `tick`           | `{ remainingMs }` — countdown (emesso ~ogni 250ms)             |
| `assigned`       | `{ playerId, playerName, participantId, teamName, price }` — lotto chiuso |
| `released`       | `{ ...ReleaseEntry, undone }` — svincolo di riparazione fatto o annullato |
| `budgetUpdated`  | `{ participantId, budget, slots, maxBid }`                      |
| `errorMsg`       | `{ code, message }` — offerta/azione rifiutata (`ErrorCode`)    |
| `finished`       | `{}` — asta terminata                                          |

Note sullo snapshot (`AuctionState`):

- `status`: `IDLE | BIDDING | ASSIGNED | PAUSED | RELEASING | FILLING | FINISHED`.
- `participants[]` porta rose **con i prezzi** (`roster: RosterEntry[]`), `spent`, `budget`
  residuo e `online` (derivato dalle socket connesse, non persistito).
- `accessCode` e `magicToken` escono **solo** verso la stanza degli admin: il gateway costruisce
  due snapshot per due pubblici (`AuctionGateway.broadcastState`).
- `currentRole` e `lot.history` sono derivati/mantenuti dal server; il client non li calcola.
- `repairRound` è `0` durante l'asta iniziale e `1, 2, …` nei mercati di riparazione;
  `releases[]` sono gli svincoli del round **in corso** (vuoto fuori dalla riparazione), cioè i
  calciatori che stanno per tornare all'asta. I round passati restano in tabella come storia.
- `log` è la **coda** della telecronaca: le ultime `LOG_TAIL` (25) righe, la più recente in
  testa. Non è la storia — quella si chiede a `GET /log`, perché spedirla in ogni snapshot
  costerebbe banda a ogni rilancio.
- Gli altri eventi arrivano **sempre** accompagnati da uno `state`: servono per suoni e
  animazioni, non per mutare lo stato lato client.

> Regola d'oro: **il timer vive sul server**. `tick` è puramente indicativo per la UI;
> la verità è `endsAt` (timestamp assoluto) inviato con `bid`/`nominated`.

### REST (setup e admin)

`GET /health`, `GET|PUT /rules`, `PUT /rules/turn-order`,
`GET /players?role=&q=&available=&taken=&take=`,
`GET /players/last-import`, `POST /players/import`, `GET /participants`,
`POST|PATCH|DELETE /participants`, `POST /participants/:id/regenerate-code`,
`POST /participants/:id/regenerate-link`,
`POST /participants/reset-auction`, `GET /log?take=&before=&type=&participantId=`,
`GET /export/rosters(.csv)`. Le scritture vogliono
l'header `x-admin-token`; `GET /participants` restituisce `accessCode` e `magicToken` solo se
il token c'è. Ogni scrittura riallinea lo stato live e ritrasmette `state`. Tabella completa in
`frontend/README.md`.

**Accesso dei partecipanti** (`auth/auth.service.ts`): si entra da un **magic link**
`<origin>/j/<magicToken>` che l'admin copia dalla tab Lega e manda in chat. Nessuna email,
nessun servizio esterno: la consegna è il messaggio stesso, e l'URL lo compone il client da
`window.location.origin`, così vale in locale e in produzione senza una env in più.
Tre credenziali, una sola porta (`auth`), e il server capisce da solo quale sia:

- il **magic token** del link — 24 byte casuali in base64url, **durevole** (lo stesso link
  deve funzionare la sera dell'asta e a gennaio in riparazione), revocabile rigenerandolo;
- la **sessione**, un JWT che il server emette dopo ogni `auth` riuscito e che il client
  salva in `localStorage`: è l'unica credenziale che finisce sul dispositivo. Dura
  `SESSION_TTL_DAYS` (30) e si rinnova a **finestra scorrevole** — sotto metà vita residua
  l'ack ne porta una nuova. Serve perché uno schermo bloccato a metà asta non deve costringere
  a ripescare il link su WhatsApp;
- il **codice a 6 caratteri**, il piano B che si detta a voce a chi il link l'ha perso.

**Revoca**: `Participant.tokenVersion` entra nel JWT e viene incrementata da
`regenerate-code` e `regenerate-link`. Rigenerare una credenziale spegne il vecchio codice o
link **e** butta giù le sessioni aperte di quella squadra, senza una tabella di sessioni da
tenere pulita. `JWT_SECRET` è obbligatoria: senza, il backend non parte (cambiarla invalida
tutte le sessioni, non i link). L'admin resta fuori da tutto questo: entra con `ADMIN_TOKEN`,
che è anche l'header delle rotte REST, e non lascia niente sul dispositivo.

**Telecronaca** (`auction/auction-log.service.ts`): giornale **append-only** di quel che è
successo in sala — chiamate, rilanci, acquisti (chi, cosa, a quanto), svincoli, comandi
d'admin, cambi di fase. `GET /log` è pubblico e in sola lettura, la più recente in testa;
`type=purchases` è l'alias dei soli acquisti, `before=<seq>` è il cursore di pagina. Due
scelte da conoscere: le righe portano **nomi denormalizzati** (restano leggibili anche se una
squadra viene cancellata) e la scrittura è **fuori dalla strada calda** — `append()` assegna
il `seq` in memoria e mette l'INSERT in coda, così un rilancio non aspetta il DB. Il reset
asta azzera anche la cronaca.

**Export delle rose** (`export/rosters-csv.ts`): CSV a tre colonne
`nomeSquadra,idCalciatore,prezzo` con separatore `$,$,$` prima di ogni blocco-squadra, il
formato che Fantacalcio.it sa importare (esempio in `resources/`). `idCalciatore` è
`Player.externalId`, l'id del listone ufficiale: chi non ce l'ha non finisce nel file e
torna in `skipped[]`. Sola lettura, ripetibile anche ad asta in corso.

## 6. Comandi rapidi

```bash
# Backend
docker compose up -d db           # Postgres locale (dalla root)
cd backend
npm install
cp .env.example .env              # valorizza DATABASE_URL e ADMIN_TOKEN
npx prisma migrate dev            # crea/aggiorna schema
npm run seed                      # lega + 8 squadre demo + mini-listone (idempotente)
npm run start:dev                 # NestJS in watch (http://localhost:3000)

# Frontend
cd frontend
npm install
npm start                         # http://localhost:4200 (proxy verso :3000)
```

## 7. Principi per l'agente

1. **Server authoritative.** Nessuna logica d'asta o di budget nel frontend.
2. **Idempotenza & validazione.** Ogni evento socket viene validato (DTO + regole) prima di mutare lo stato.
3. **Zero-cost aware.** Non introdurre dipendenze che richiedono servizi a pagamento
   senza segnalarlo in `INFRA.md`.
4. **TypeScript strict.** Niente `any` non giustificati. Tipi condivisi dei payload in `auction/dto/events.ts`.
5. **Piccoli PR.** Una fase di `PLAN.md` per PR, con test dove ha senso.
6. Se tocchi il contratto socket, aggiorna **contemporaneamente** questa sezione, `dto/events.ts` e `frontend/README.md`.

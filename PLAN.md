# PLAN.md — Roadmap di implementazione

Roadmap a fasi. Ogni fase ≈ 1 PR. Spuntare i box a completamento. Le fasi 0–4 sono il
"cuore" per avere un'asta funzionante; le 5–7 rifiniscono ed effettuano il deploy.

## Fase 0 — Scaffolding & infrastruttura locale
- [x] Struttura monorepo (`backend/`, `frontend/`) e documenti (`CLAUDE/AGENTS/PLAN/INFRA`).
- [x] `docker-compose.yml` con Postgres.
- [x] NestJS boilerplate (`main.ts`, `app.module.ts`, `ValidationPipe`, CORS).
- [x] Prisma + `schema.prisma` iniziale + `PrismaService`.
- [x] `npm install` e prima `prisma migrate dev` verde (migrazione `20260727150755_init`).

## Fase 1 — Modello dati & regole (config lega)
- [x] Entità: `League`(regole), `Participant`, `Player`, `Acquisition`.
- [x] Modulo `rules`: GET/PUT configurazione lega (rosterSlots, budget, callOrder,
      bidTimerSeconds, startPriceMode/startPrice, leagueName/auctionName) + `PUT /rules/turn-order`.
- [x] Seed di default (`P:3,D:8,C:8,A:6`, budget 300, timer 5s, callOrder `fixed`) con le 8
      squadre demo e i loro codici d'accesso.
- [x] Validazione: `turnOrder` coerente con i partecipanti esistenti.
- [x] Cambio di `budget` a metà asta: i crediti residui si ricalcolano su `budget - speso`.

## Fase 2 — Import calciatori (xlsx Fantacalcio.it)
- [x] Endpoint `POST /players/import` (multipart, `multer`) → `{ imported, updated, total }`.
- [x] Parser `xlsx` tollerante: trova la riga header (colonne `Nome`, `Squadra`, `R`, `Qt.A`, ...).
- [x] Match per `id` Fantacalcio (`externalId`) con fallback su (`nome`+`squadra`); ruolo classico `P/D/C/A`.
- [x] `GET /players?q=&role=&available=&take=` — ordinato per quotazione DESC, con `taken`.
- [x] Re-import: aggiorna quotazioni/ruoli, non cancella nulla, non tocca le `Acquisition`.
- [x] `GET /players/last-import` (filename + data + conteggio) per la tab Listone.

## Fase 3 — Partecipanti
- [x] CRUD `participants` (nome, teamName, avatarUrl, color, budget, `accessCode`).
- [x] `POST /participants/:id/regenerate-code` e `POST /participants/:id/regenerate-link`.
- [ ] Upload avatar (opzionale): su free-tier preferire URL esterno o storage effimero → vedi INFRA.
- [x] Reset asta (azzera acquisizioni, ripristina budget, riapre i reparti chiusi).

## Fase 4 — Motore d'asta realtime (core) ⭐
- [x] `auction-engine.ts`: funzioni pure — `canNominate`, `computeMaxBid`, `validateBid`,
      `canClaim`, `canAssignManual`, `applyAssignment`/`applyPurchase`, `currentRole`, `nextTurn`.
- [x] `auction.gateway.ts`: gateway Socket.IO namespace `/auction`, `auth` con ack.
- [x] Macchina a stati: `IDLE → BIDDING → ASSIGNED → (next turn) … → FILLING → FINISHED`
      (+ `PAUSED`), con un solo punto che decide la fase (`continueAuction`).
- [x] **Timer server-authoritative**: reset ad ogni rilancio valido; `endsAt` assoluto; `tick` ~250ms.
- [x] **Serializzazione** delle mutazioni (coda `run()` per la lega) contro le race sui rilanci.
- [x] Persistenza risultato lotto (`Acquisition`) + aggiornamento budget + broadcast `state`.
      Vincolo unico `(leagueId, playerId)` come rete di sicurezza → `PLAYER_TAKEN`.
- [x] Riconnessione client → `state` completo alla connessione e dopo `auth`.
- [x] Presenza `online` derivata dalle socket connesse (conteggio per partecipante).
- [x] Test unit dell'engine (30 casi: max bid, slot saturi, callOrder fixed/free, reparti
      chiusi, svincoli, chiusura senza rilanci) + smoke test end-to-end sul gateway reale.

## Fase 5 — Pannello Admin (backend a supporto)
- [x] Guard admin (token) su rotte REST e eventi `admin:*` (`FORBIDDEN` sul socket).
- [x] Comandi live: `start`, `pause`, `resume`, `skipTurn`, `assignManual`, `advanceRole`,
      `reopenLot`.
- [x] Bottone "riapri lotto" nella Regia: ricerca fra i soli venduti (`GET /players?taken=true`),
      anteprima di chi viene rimborsato e da che prezzo si ribatte, spento a lotto aperto.
- [x] Riepiloghi: rose correnti, spesa e crediti residui per partecipante sono nello snapshot
      `state` e in `GET /participants`; disponibili in `GET /players?available=true`.
- [x] Export finale rose nel CSV di Fantacalcio.it (`GET /export/rosters`, `/export/rosters.csv`)
      + bottone in Regia. Formato `nomeSquadra,idCalciatore,prezzo` con separatore `$,$,$`
      per blocco-squadra; `idCalciatore` è `Player.externalId`, chi non ce l'ha esce in
      `skipped[]` e la Regia lo elenca.

## Fase 6 — Integrazione frontend (Claude Design)
- [x] Importare l'output di Claude Design in `frontend/` (Angular 22 standalone/signals/zoneless).
- [x] Implementare `SocketService` sul contratto → `core/auction.store.ts` + `core/socket.adapter.ts`
      (`SocketPort`/`ApiPort` astratti, mock ↔ reale scelto in `core/providers.ts`).
- [x] Schermate: Accesso, Sala d'asta (turno, chiamata, rilancio, countdown da `endsAt`),
      Rosa, Lega, Admin (Lega e partecipanti, Listone, Regole, Regia).
- [x] Proxy dev `4200 → 3000` (`proxy.conf.json`, `ws: true`); `environment.ts` per URL API/socket
      con `fileReplacements` in produzione.
- [x] Mock backend in-memory (`core/mock/`) per sviluppo offline: `environment.useMock`.
- [x] **Allineare il contratto socket** (decisioni 5 e 6) e spegnere `useMock` contro il
      gateway reale: `environment.useMock` è ora `false` di default (il mock resta per lo
      sviluppo offline della UI).

## Fase 7 — Deploy zero-cost

Stack scelto dopo il confronto dei tier gratuiti a luglio 2026 (analisi e fonti in
`INFRA.md`): **Cloudflare Pages** (frontend, banda illimitata) + **Render free web
service** (backend, istanza singola) + **Neon** (Postgres scale-to-zero). Railway e
Fly.io non hanno più un free tier; il Postgres free di Render scade a 30 giorni.

Pronto nel repo:
- [x] `render.yaml` — blueprint del backend: piano free, `rootDir: backend`, health
      check `/health`, `prisma migrate deploy` allo start, `ADMIN_TOKEN`/`JWT_SECRET`
      generati da Render e segreti `sync: false`.
- [x] **CORS + `origin` socket** — `FRONTEND_ORIGIN` accetta più origin separati da
      virgola (`src/config/cors.ts`), condivisi da REST e gateway: serve per stare
      dietro alle anteprime `*.pages.dev` senza un redeploy per ogni dominio.
- [x] Fallback SPA `frontend/public/_redirects` (`/* /index.html 200`): senza,
      `/j/<magicToken>` aperto da zero prende un 404 dell'hosting.
- [x] Node pinnato a 22 (`.node-version` in `backend/` e `frontend/`).

Da fare sugli account (serve il repo su GitHub):
- [ ] Repo su GitHub — Render e Pages deployano da lì.
- [ ] Progetto Neon + `DATABASE_URL` (stringa **diretta**, non il pooler: `migrate
      deploy` non passa da pgBouncer e un processo unico non ha bisogno di pooling).
- [ ] Blueprint su Render, poi `FRONTEND_ORIGIN` con il dominio Pages definitivo.
- [ ] Pages: root `frontend`, output `dist/frontend/browser`; `environment.prod.ts`
      con l'URL del backend.
- [ ] Cron keep-warm su `GET /health` ogni 10 min — **obbligatorio in serata** (è
      quel che neutralizza la decisione 17), da tenere **spento** fuori dalle serate:
      750 h/mese su Render e 100 CU-h/mese su Neon non reggono un 24/7 perenne.
- [ ] Prova end-to-end in produzione con 2 dispositivi prima della serata vera.

---

## Backlog / nice-to-have
- [x] Log/telecronaca dell'asta (chi ha comprato cosa e a quanto) — vedi decisione 19.
- [x] Modalità "riparazione" (mercato invernale) con budget residuo — vedi decisione 20.
- [x] Autenticazione partecipanti (magic link) invece del solo token condiviso — vedi decisione 21.

## Decisioni aperte

1. - [x] **Prezzo base chiamata**: *risolta come regola di lega.* `startPriceMode:
     'fixed' | 'quotation'` + `startPrice` (default `1`) sono nello schema Prisma e in
     `AuctionRules`; `nominate` accetta un `startPrice` opzionale con cui il chiamante può
     **alzare** il prezzo base, mai scendere sotto `1` (`auction-engine.startPriceFor`).
2. - [x] Re-import xlsx a metà asta: *confermato*. L'import aggiorna quotazione/ruolo/FVM,
     non cancella nessun calciatore e non tocca le `Acquisition`; le rose già fatte restano
     valide. Un giocatore già assegnato resta `taken` e non ricompare fra i chiamabili.
3. - [ ] Storage avatar su free-tier: URL esterno vs. base64 in DB vs. bucket (proposto: URL esterno per restare a costo 0).
     Oggi `avatarUrl` è una stringa libera e la UI ricade sulle iniziali: nessun upload.
4. - [x] Parità di offerta simultanea: vince il **primo** che entra nella coda `run()` del
     service; al secondo il motore risponde `BID_TOO_LOW` (o `PLAYER_TAKEN` sugli svincoli).

### Aperte dall'import del frontend (fase 6)

5. - [x] **Forma di `AuctionState`** — *risolta*: il server ha adottato la forma ricca.
     `backend/src/auction/dto/events.ts` e `frontend/src/app/core/auction-events.ts` sono lo
     stesso contratto (`status`, `lot.history`, rose con i prezzi, `spent`, `online`,
     `lastAssigned`, `currentRole`, `closedRoles`); `playerId` è un intero.
     `CLAUDE.md` §5 e `frontend/README.md` aggiornati nello stesso PR.
6. - [x] **Sessione dopo `auth`** — *risolta con l'ack* `{ ok, isAdmin, participantId }`
     (nessun evento `session`). Il token è il codice squadra oppure `ADMIN_TOKEN`; con
     `participantId` il server verifica che il codice sia di quella squadra (`AUTH_MISMATCH`).
7. - [x] **Codici d'accesso partecipante** — restano codici a 6 caratteri (alfabeto senza
     0/O/1/I, si dettano a voce), non JWT: sono usa-e-getta e rigenerabili. Il gateway
     costruisce **due** snapshot e `accessCode` esce solo verso la stanza degli admin; anche
     `GET /participants` lo include solo con `x-admin-token`. Il mock resta permissivo: gira
     solo in locale.
     *Estesa dalla decisione 21*: il codice resta, ma come **fallback** — la via normale è il
     magic link, e `magicToken` segue le stesse regole di riservatezza di `accessCode`.
8. - [x] **Rotte REST mancanti** — implementate: `POST /participants/:id/regenerate-code` e
     `GET /players/last-import` (`{ filename, at, count }`).
9. - [x] **House rules** — *risolta rimuovendole*. Gli **svincoli a fine asta** sono diventati una
     regola vera del motore (decisione 13), quindi non erano un interruttore: la fase `FILLING`
     arriva da sé. **Pausa fra i giri** e **aste cieche** non hanno mai avuto un effetto e non
     valevano una regola di lega: il blocco "house rules" della tab Regole è stato **cancellato**
     (`admin-rules-tab`, più le classi `.toggle*` in `styles.scss`, usate solo lì). Se una delle due
     tornasse utile, va rifatta come regola di lega: schema Prisma → `AuctionRules` → motore.
10. - [x] **Presenza** — *risolta*: `AuctionService` conta le socket per partecipante
      (`connectParticipant`/`disconnectParticipant`); `online` è vero finché ne resta almeno
      una, così due schede aperte non si spengono a vicenda. Non è persistito.
11. - [x] **Nome lega / nome asta** — `League.leagueName` e `League.auctionName` nello schema
      Prisma, esposti da `GET /rules` e modificabili dalla tab Lega.
12. - [x] **`callOrder: 'fixed'` → interpretazione DI LEGA.** *Risolta.*
      Il reparto in corso è **uno per tutta la lega**: si completa `P` per tutti, poi `D`, poi `C`,
      poi `A`. Chi ha già saturato il reparto in corso **viene saltato** nel giro dei turni finché
      il reparto non cambia. Era già la lettura di `CLAUDE.md` §4: il motore backend aveva derivato
      verso una lettura per-partecipante, ora rimossa.
      - Backend: `currentRole(participants, rules)` e `canTakeTurn(p, rules, leagueRole)` sostituiscono
        `requiredRole`; `advanceTurn()` salta per reparto; `canNominate` prende `leagueRole` e
        risponde `ROLE_LOCKED`; `AuctionState.currentRole` derivato in `snapshot()` a ogni emissione.
        L'assegnazione manuale dell'admin passa `leagueRole: null` (non vincolata al reparto, ma
        restano slot e budget).
      - Frontend/mock: `nextTurn` + `currentRole`; UI in `RoleProgress` e `NominateSearch`.
13. - [x] **Avanzamento forzato del reparto + svincoli finali.** *Implementata su entrambi i lati.*
      Caso d'uso: restano pochi slot in un reparto che nessuno si contenderebbe (li comprerebbero
      a 1 credito senza asta). L'admin chiude il reparto in anticipo (`admin:advanceRole`); gli slot
      rimasti **non tornano all'asta**. Quando non resta nessun reparto da battere ma ci sono rose
      incomplete, l'asta entra in `FILLING`: ognuno completa la rosa prendendo i rimasti a
      **1 credito fisso** (`claim`), senza turni né rilanci.
      - Contratto: `AuctionStatus` + `FILLING`, `AuctionState.closedRoles`, eventi
        `claim` e `admin:advanceRole`, costante `FILLING_PRICE`.
      - Backend: `currentRole(state)`, `canClaim`, `remainingSlotsInRole`, `needsFilling`,
        `isFinished`; `continueAuction()` come unico punto che decide la fase;
        `advanceRole()` e `claim()` nel service, handler nel gateway.
      - Prisma: `League.closedRoles Role[]` e `AuctionStatus.FILLING`, **migrati** in
        `20260727150755_init`. Il reset asta riapre i reparti chiusi.
      - Scelte confermate: l'avanzamento è **irreversibile** (un reparto chiuso non si riapre) ed
        è vietato a lotto aperto; lo svincolo costa `1` fisso (`FILLING_PRICE`) e **non** il
        prezzo base di lega.

### Nuove, dall'allineamento del backend

14. - [x] **Fase `ASSIGNED`** — dopo la chiusura di un lotto la sala resta sul risultato per
      `ASSIGNED_HOLD_MS` (2,5s) prima di passare il turno, come faceva il mock: serve a far
      registrare a tutti chi ha comprato cosa. Il valore è nel contratto, non in una regola di lega.
15. - [x] **`admin:assignManual` avanza il turno.** Si comporta come un lotto chiuso (risultato
      a schermo, poi turno successivo), quindi consuma il turno di chi stava chiamando. È il
      caso d'uso previsto (l'admin sta registrando o correggendo un acquisto); se servisse
      un'assegnazione "silenziosa" va aggiunta come comando separato. Rifiutata a lotto aperto.
16. - [x] **`admin:skipTurn` a lotto aperto lo annulla** senza assegnarlo a nessuno (come il
      mock). Nessun rimborso da fare: il lotto non era ancora stato pagato.
17. - [ ] **Riavvio a lotto aperto**: lo stato live si ricostruisce dal DB, ma il lotto in corso
      è perso e la sala torna a `IDLE` sul turno del primo eleggibile. Accettabile per una serata
      d'asta (il lotto si ribatte); da rivedere solo se il backend inizia a riavviarsi spesso.
18. - [x] **`reopenLot`: si rimborsa il compratore e si ribatte.** *Decisa dal maintainer,
      implementata.* `admin:reopenLot { playerId }` cancella l'`Acquisition`, restituisce i
      crediti e riapre il lotto **al prezzo base di lega** (non al prezzo di vendita: si
      ribatte da zero).
      - La chiamata torna a chi l'aveva fatta: `Acquisition.nominatedById` (nuovo campo,
        `null` per svincoli e assegnazioni manuali). Se quel partecipante non ha più slot o
        crediti per il prezzo base, il lotto lo tiene il compratore rimborsato — che ha
        sempre lo slot libero, appena liberato dal rimborso. Se non può nemmeno lui:
        `INSUFFICIENT_CREDITS` e si suggerisce l'assegnazione manuale.
      - **In pausa si riapre senza timer**: `resume` fa ripartire il countdown pieno. È il
        flusso naturale di una contestazione (pausa → sistemo → riprendo).
      - Vietato a lotto aperto (`LOT_OPEN`); `NOT_ASSIGNED` se il calciatore è libero.
      - Funziona anche durante gli svincoli e a asta finita: chiuso il lotto ribattuto,
        `continueAuction` ricalcola la fase (torna a `FILLING`/`FINISHED` se serve).
      - Engine: `applyRefund` (inverso puro di `applyPurchase`) e `canHoldLot`.
      - UI: sezione "Riapertura di un lotto" nella Regia, con ricerca fra i soli venduti
        (nuovo filtro `GET /players?taken=true`). Implementata anche nel mock, così
        `useMock: true` si comporta allo stesso modo.
19. - [x] **Telecronaca dell'asta.** *Implementata su entrambi i lati* (voce di backlog
      "Log/telecronaca"). Giornale **append-only** di quel che è successo in sala: `start`,
      `nominate`, `bid`, `assigned`, `claim`, `manual`, `reopen`, `skip`, `roleClosed`,
      `pause`, `resume`, `filling`, `finished`, `reset`.
      - Prisma: `AuctionLogEntry` + enum `AuctionLogType`, migrazione `20260727194831_auction_log`.
        **Nessuna relazione** verso `Participant`/`Player` e nomi denormalizzati: una riga di
        cronaca deve restare leggibile anche dopo la cancellazione di una squadra (stessa
        scelta di `Acquisition.nominatedById`).
      - Contratto: `AuctionLogEntry`, `AuctionLogType`, `LOG_TAIL` e `AuctionState.log`.
        **Nessun evento socket nuovo**: la coda recente viaggia dentro `state`, così resta
        vero che `state` è l'unica fonte di stato del client.
      - Scelte confermate:
        - **La coda nello snapshot, la storia in REST.** In `state.log` vanno le ultime 25
          righe; tutta la cronaca in ogni snapshot costerebbe banda a ogni rilancio (una
          serata fa qualche migliaio di righe). `GET /log` è pubblico, paginato con
          `before=<seq>`, filtrabile per `type` (alias `purchases`) e `participantId`.
        - **La scrittura non blocca l'asta.** `AuctionLogService.append()` è sincrona: assegna
          il `seq` in memoria e mette l'INSERT in una coda FIFO sua. Il rilancio è la strada
          calda (dentro il mutex della lega) e non deve aspettare il DB — su tier gratuito
          sono decine di ms per riga. Una scrittura persa costa una riga di cronaca, non
          un'assegnazione. `clear()` passa dalla stessa coda, così il reset non scavalca le
          scritture in volo.
        - **`seq` lo assegna il processo**, non un autoincrement: la riga deve avere il suo
          numero prima che il DB risponda. Vincolo `(leagueId, seq)` come rete di sicurezza.
        - **Append-only**: `reopenLot` non riscrive la riga della vendita, ne aggiunge una che
          la spiega. Il reset asta invece azzera tutto (quella cronaca non racconta più niente
          di ciò che si vede a schermo).
        - **La frase la compone il client** (`features/log/log-line.ts`, pura e testata): il
          server manda i fatti, non il testo.
      - UI: pagina `/storia` (nav "Storia") con filtri Tutto/Acquisti/Rilanci e per squadra,
        che fonde la coda in diretta con le pagine REST per `seq`. `BidFeed` in sala, quando
        non c'è un lotto aperto, mostra le ultime righe di cronaca invece di restare muto.
        Implementata anche nel mock, così `useMock: true` si comporta allo stesso modo.
20. - [x] **Mercato di riparazione (`RELEASING`).** *Implementata su entrambi i lati.*
      Riapre l'asta a metà stagione sulle rose esistenti. La scelta portante è che **non ha un
      motore suo**: `startRepair` rimette buchi nelle rose e `admin:start` riapre la sala, dopodiché
      `currentRole`, `canTakeTurn`, `nextTurn`, `FILLING` e `isFinished` funzionano già come
      sull'asta iniziale — sanno da sempre gestire rose parzialmente piene. Il lavoro vero sono
      gli svincoli e la contabilità dei crediti.
      - Contratto: `AuctionStatus` + `RELEASING`, `ReleaseRefund`, `AuctionRules.releaseRefund`,
        `ReleaseEntry`, `AuctionState.repairRound` e `.releases`, eventi `release`/`unrelease`/
        `admin:startRepair` + broadcast `released`, codici `NOT_RELEASING`/`NOT_IN_ROSTER`/
        `NOT_RELEASED`, tipi di cronaca `repairStart`/`release`/`unrelease`.
      - Prisma (`20260728070955_repair_market`, additiva): enum `ReleaseRefund`,
        `AuctionStatus.RELEASING`, `League.releaseRefund`/`.repairRound`,
        `Participant.creditAdjustment`, model `Release`.
      - Engine: `refundFor`, `canRelease`, `canUnrelease`, `applyRelease`, `applyUnrelease`.
      - Decisioni prese col maintainer:
        - **Chi taglia: i partecipanti.** Nuovo stato `RELEASING` con una finestra di svincolo,
          non un pannello admin: è il flusso vero di una serata. La chiude `admin:start` (un
          comando in meno nel contratto, e la Regia ha già il bottone).
        - **Rimborso: regola di lega a quattro modi** — `none`, `purchase` (default),
          `quotation`, `average` (arrotondata per difetto: i crediti sono interi).
        - **Ricarica opzionale** `extraBudget`, uguale per tutti; 0 = solo budget residuo.
        - **Nessun tetto ai movimenti**: bastano slot e crediti come vincoli.
      - Scelte tecniche che vale la pena conoscere:
        - **Nuovo invariante dei crediti.** `Participant.creditAdjustment` esiste perché con un
          rimborso diverso dal prezzo pagato `budget + speso = budget di lega` si rompe. Quello
          vero è `budget = League.budget + creditAdjustment − speso`, e `rebalanceBudgets` ci si
          appoggia: senza, alzare il tetto di lega dopo una riparazione cancellerebbe ricariche
          e rimborsi. Il reset asta lo azzera insieme a `repairRound` e alle `Release`.
        - **Guardia anti-stallo sul taglio.** Non si svincola se dopo il taglio non resta 1
          credito per ogni slot vuoto: altrimenti quello slot non sarebbe più riempibile nemmeno
          negli svincoli a 1 credito, `isFinished` non diventerebbe mai vero e l'asta si
          pianterebbe in `FILLING`. È la stessa riserva che fa `computeMaxBid`.
        - **`unrelease`, non solo `release`.** Un taglio è distruttivo e la finestra non è ancora
          chiusa: annullarlo è gratis e salva la serata. La riga `Release` conserva `price`,
          `refund` e `nominatedById`, così il giro indietro è esatto anche con rimborsi diversi
          dal prezzo e `reopenLot` non perde la memoria di chi aveva chiamato.
        - **L'`Acquisition` si cancella** invece di essere marcata: il vincolo unico
          `(leagueId, playerId)` deve tornare libero perché il calciatore possa essere
          ricomprato, anche dalla stessa squadra.
        - **I reparti chiusi si riaprono**: `advanceRole` era una decisione dell'asta d'agosto.
        - **A finestra aperta i comandi d'asta si rifiutano** (`NOT_IDLE`) invece di girare a
          vuoto: eseguirli passerebbe da `continueAuction` e chiuderebbe la finestra di nascosto.
      - UI: `ReleasePanel` in sala (rosa propria per reparto, tagli annullabili, svincoli degli
        altri in coda), sezione "Mercato di riparazione" in Regia con la ricarica, selettore del
        rimborso nella tab Regole. La cifra sul bottone è una stima e con `quotation`/`average`
        non è calcolabile lato client (`RosterEntry` non porta la quotazione): il bottone dice
        solo «Svincola» e a rifiutare è il server. Implementata anche nel mock — i bot simulati
        tagliano qualcuno a finestra aperta, così `useMock: true` è demoabile.
      - Verifica: 20 casi nuovi in `auction-engine.spec.ts` (67 verdi in tutto) + una verifica
        end-to-end usa-e-getta dell'invariante contro DB e servizi reali (ciclo completo
        riparazione → svincolo a quotazione → cambio tetto → annullamento → reset).
21. - [x] **Magic link dei partecipanti.** *Implementata su entrambi i lati* (voce di backlog
      "Autenticazione partecipanti"). Sostituisce il "digita il codice" come via normale, senza
      buttare via la decisione 7: il codice a 6 caratteri resta, ma come piano B.
      - Contratto: `Participant.magicToken` (solo admin, come `accessCode`), `SessionToken`,
        `AuthAck.session`, codice `SESSION_EXPIRED`. `auth` non cambia forma: è sempre
        `{ token, participantId? }`, è il server a capire che credenziale sia.
      - Prisma (`20260728074340_participant_magic_link`, additiva con backfill):
        `Participant.magicToken` (unico) e `Participant.tokenVersion`.
      - Backend: `auth/auth.service.ts` (nuovo) risolve l'identità ed emette le sessioni;
        `rules/league.util.randomMagicToken`; `POST /participants/:id/regenerate-link`;
        `AuctionService.findByAccessCode` **rimosso** (l'identità non è più roba dell'asta).
      - Frontend: rotta `/j/:token` + `MagicLinkPage`, `SessionStore` con persistenza,
        `AuctionStore.init()` memoizzato che riprende la sessione, guard che l'aspettano,
        copia/rigenera link nella tab Lega.
      - Decisioni prese col maintainer:
        - **Solo link, niente email.** La consegna è il messaggio che l'admin manda in chat:
          nessun provider, nessun dominio, nessun campo email. Resta il costo ~0 di INFRA.md.
        - **Token durevole + JWT di sessione**, non link usa-e-getta: lo stesso link deve
          funzionare la sera dell'asta e a gennaio in riparazione.
        - **Il codice a 6 caratteri resta** il fallback dettabile a voce.
        - **L'admin resta com'è**: `ADMIN_TOKEN` digitato, che è anche l'header REST.
      - Scelte tecniche che vale la pena conoscere:
        - **Cosa finisce sul dispositivo.** Solo il JWT di sessione, in `localStorage`. Mai il
          magic token né il codice: sono credenziali durevoli, e la nota che c'era in
          `session.store.ts` ("niente localStorage per un codice a 6 caratteri") resta valida —
          quel che si salva ora è una credenziale che scade da sola e si revoca.
        - **Revoca senza tabella di sessioni.** `Participant.tokenVersion` entra nel JWT e la
          incrementano `regenerate-code` e `regenerate-link`. Una tabella di sessioni andrebbe
          anche tenuta pulita, e per otto squadre non vale il prezzo.
        - **Finestra scorrevole** (`SESSION_TTL_DAYS` 30, rinnovo sotto metà vita): chi entra
          ogni tanto non si vede scadere la sessione sotto il naso, chi sparisce per un mese
          rientra dal link.
        - **La scadenza la decide `AuthService.issue`**, non la configurazione del `JwtModule`:
          la firma e l'`expiresAt` dichiarato nell'ack devono venire dalla stessa costante,
          altrimenti un JWT senza `exp` passerebbe la verifica e non scadrebbe mai.
        - **`JWT_SECRET` obbligatoria**: senza, il backend non parte. Una sessione firmata con
          un segreto vuoto la fabbrica chiunque — stessa logica di `ADMIN_TOKEN`.
        - **L'URL lo compone il client** da `window.location.origin`: il server manda solo il
          token e non deve conoscere il suo indirizzo pubblico (una env in meno in produzione).
        - **Il token sparisce dall'URL** appena usato (`replaceUrl`): non deve restare nella
          cronologia né in uno screenshot della sala.
        - **Ri-`auth` sulla riconnessione.** Era un buco che c'era già: la sessione del server
          vive sulla socket, quindi dopo un drop il client tornava spettatore fino a un
          ricaricamento. Ora all'evento `connect` si ripresenta da solo.
        - **`AuctionStore.init()` memoizzato** e atteso dalle guard: senza, ricaricare su
          `/asta` rimbalzerebbe all'accesso un istante prima della risposta del server. Con un
          timeout, perché un backend in spin-down non deve lasciare l'app appesa.
      - Verifica: 11 casi in `auth.service.spec.ts` e 6 in `session.store.spec.ts` (78 backend,
        33 frontend) + una verifica end-to-end usa-e-getta contro gateway, DB e servizi reali
        (link → sessione → rientro → rigenerazione → revoca → codice di riserva → admin).

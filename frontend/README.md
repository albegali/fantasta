# frontend/ — Angular 22 (importato da Claude Design)

UI dell'asta, generata con **Claude Design** e portata qui
da `Asta Fantacalcio.dc.html` + `mock/`. Il frontend è **"dumb"**: mostra lo stato e invia
intenzioni; **tutta** la logica d'asta è sul backend (`../AGENTS.md` §1).

## Setup

```bash
npm install
npm start          # ng serve + proxy → http://localhost:4200
npm test           # vitest
npm run build      # bundle di produzione in dist/
```

Di default parla col **backend reale** (`useMock: false`): serve NestJS su `:3000`
(`cd ../backend && npm run start:dev`, vedi `../AGENTS.md`). Per lavorare sulla UI offline
metti `useMock: true` in `src/environments/environment.ts`: entra in scena il mock
in-memory di `core/mock/`, con avversari simulati che chiamano e rilanciano da soli.

Chi partecipa entra dal **magic link** che l'admin copia dalla tab Lega
(`<origin>/j/<magicToken>`) e resta dentro anche dopo un ricaricamento. Il codice a 6
caratteri è il fallback: quelli delle squadre demo (`npm run seed` sul backend, stessi valori
del mock) sono `7KQ2MX`, `P4WZ9A`, `B3HN6T`, `R8VJ2C`, `L5DY7F`, `M9XK3S`, `T6QW8N`, `Z2FP5H`.
Con `useMock: true` i link sono leggibili apposta — `/j/mock-link-7kq2mx` e compagni — così si
prova il flusso senza backend. Il token admin è l'`ADMIN_TOKEN` del backend (nel mock è
`ADMIN-2026`).

## Come è fatto

```
src/
├── styles.scss                     # token del tema Prato + classi d'applicazione
├── environments/                    # useMock, apiUrl, socketUrl
└── app/
    ├── app.ts|html                  # shell: topbar, nav, toast errorMsg
    ├── app.routes.ts                # '' | j/:token | asta | rosa | lega | storia | admin
    ├── core/
    │   ├── auction-events.ts        # CONTRATTO: tipi dei payload socket
    │   ├── ports.ts                 # SocketPort + ApiPort (classi astratte)
    │   ├── providers.ts             # ⟵ l'unico punto mock ↔ reale
    │   ├── socket.adapter.ts        # socket.io-client su /auction
    │   ├── rest-api.adapter.ts      # REST admin con x-admin-token
    │   ├── auction.store.ts         # stato client a signal + intenzioni
    │   ├── session.store.ts         # chi sono io (dall'ack di `auth`) + sessione salvata
    │   ├── alerts.service.ts        # bip + vibrazione sui rilanci
    │   ├── joined.guard.ts
    │   └── mock/                    # backend finto in-memory (+ test)
    ├── shared/                      # avatar, chip di ruolo, contatori
    └── features/
        ├── join/                    # magic link (`/j/:token`) + accesso a mano
        ├── auction/                 # TurnBanner, NominateSearch, LotCard + TimerRing, BidFeed,
        │                            #   PresenceList, FillingPanel, ReleasePanel (riparazione)
        ├── roster/                  # la mia rosa
        ├── league/                  # tutte le squadre
        ├── log/                     # telecronaca (+ `log-line.ts`: da fatto a frase)
        └── admin/                   # tab Lega, Listone, Regole, Regia
```

Due regole di struttura da non rompere:

1. **Un solo punto di sostituzione del trasporto.** La UI dipende da `SocketPort` e
   `ApiPort`, mai da `socket.io-client` o da `HttpClient`. Chi risponde lo decide
   `core/providers.ts` leggendo `environment.useMock`.
2. **Il countdown vive dentro `TimerRing`.** È l'unico componente che legge
   `remainingSeconds`, che cambia ~4 volte al secondo: così presenze, feed e perfino i
   bottoni di rilancio non si ridisegnano a ogni tick. `LotCard` ne sa solo la soglia
   (`urgent()`, un booleano: un `computed` non propaga se il valore non cambia). Se ti serve
   il tempo residuo altrove, fermati e ripensaci.
3. **La lista di chiamata la filtra il server.** `NominateSearch` chiede
   `listPlayers({ role: currentRole, available, take })` e mostra quel che torna: non
   ri-filtra e non riordina lato client. A campo vuoto (click/focus) sono i 20 più
   quotati disponibili; digitando è autocomplete a 10 risultati, che include i già
   assegnati per spiegare perché un nome non è chiamabile.

### `callOrder: 'fixed'` — reparto in corso

Il reparto è **uno per tutta la lega** (`state.currentRole`): si completano i portieri per
tutti, poi i difensori, e così via. Conseguenze in UI:

- la ricerca mostra **solo** il reparto in corso (filtro `role` al server);
- `RoleProgress` in cima alla sala mostra reparto, avanzamento `slot riempiti/totali` e la
  sequenza `P D C A`;
- chi ha saturato il reparto **viene saltato** nel giro dei turni: la UI lo dice, sia in
  `RoleProgress` sia nel pannello d'attesa. Il salto è **regola di server**
  (`nextTurn` nel mock, `canTakeTurn` + `advanceTurn` nel backend), non una scelta del
  client — vedi `PLAN.md` decisione 12, chiusa su entrambi i lati;
- l'admin può **chiudere il reparto in anticipo** dalla Regia (`admin:advanceRole`): gli slot
  rimasti restano vuoti e `RoleProgress` li conta come "lasciati indietro" (reparto barrato).

### Svincoli finali (`status: 'FILLING'`)

Quando non resta nessun reparto da battere ma ci sono rose incomplete, l'asta apre gli
svincoli: `FillingPanel` mostra i rimasti raggruppati per reparto scoperto e ogni riga è un
`claim` a **1 credito** (`FILLING_PRICE`). Niente turni, niente timer, niente `TurnBanner`.
Chi clicca prima se lo prende: il server serializza e al secondo risponde `PLAYER_TAKEN`.

### Mercato di riparazione (`status: 'RELEASING'`)

L'admin apre il mercato dalla Regia (`admin:startRepair`, con una ricarica di crediti
opzionale) e la sala entra in **finestra di svincolo**: `ReleasePanel` prende il posto della
chiamata e del lotto, `TurnBanner` sparisce (non ci sono turni).

Nel pannello ognuno vede **la propria rosa** per reparto, i più cari in testa, e taglia con un
bottone che porta la cifra del rimborso. I propri tagli restano in cima, ognuno con
«Annulla» — l'annullamento vale finché la finestra è aperta. Sotto, i tagli **degli altri**:
è il lotto che sta per tornare all'asta, e vederlo crescere è metà del divertimento.

La cifra sul bottone è una **stima**: con `releaseRefund` a `quotation` o `average` serve la
quotazione aggiornata, che `RosterEntry` non porta, quindi `AuctionStore.refundPreview` torna
`null` e il bottone dice solo «Svincola». Stessa storia per la guardia anti-stallo: la UI
spegne il bottone solo quando sa fare il conto, altrimenti lascia rifiutare il server. È il
solito patto di `maxBid` — il client accende e spegne, il server decide.

Chiusa la finestra con «Chiudi gli svincoli e riparti», l'asta riprende **come sempre**: reparto
in corso, turni che saltano chi è pieno, svincoli finali, fine asta. Non c'è una seconda
macchina a stati.

### Riapertura di un lotto (`admin:reopenLot`)

In Regia, sotto l'assegnazione manuale: si cerca fra i **soli venduti**
(`listPlayers({ q, taken: true })` — il filtro è del server) e prima di premere si legge
chi verrà rimborsato, di quanto, e da che prezzo si ribatte. Il bottone è spento a lotto
aperto, perché il server rifiuterebbe con `LOT_OPEN`.

Il resto lo decide il server (`../CLAUDE.md` §4): rimborso del compratore, ritorno all'asta
dal prezzo base, chiamata a chi l'aveva fatta. Se la sala è in pausa il lotto si riapre
**senza** far ripartire il timer — l'hint sotto al bottone lo dice — e ci pensa `Riprendi`.

### Telecronaca (`/storia`)

La cronaca dell'asta: chi ha chiamato, chi ha rilanciato, **chi ha comprato cosa e a quanto**,
più svincoli, comandi d'admin e cambi di fase. La pagina legge da **due** sorgenti e le fonde
per `seq` (progressivo del server, quindi la fusione è una deduplicazione):

- `state.log` — la coda delle ultime `LOG_TAIL` (25) righe, che arriva con ogni snapshot: la
  pagina si aggiorna da sola mentre l'asta va avanti, **senza polling**;
- `api.getLog()` (`GET /log`) — la storia vera, a pagine di 100, con i filtri Tutto /
  Acquisti / Rilanci e per squadra. Il filtro attivo vale anche per le righe in diretta,
  altrimenti un rilancio comparirebbe nella vista "Acquisti".

La **frase** la compone il client (`features/log/log-line.ts`, funzione pura con i suoi test):
il server manda i fatti. È lo stesso posto da cui `BidFeed` pesca quando non c'è un lotto
aperto — fra un turno e l'altro il pannello della sala racconta la cronaca invece di restare
muto.

## Config ambiente

`src/environments/environment.ts` (dev) e `environment.prod.ts` (build di produzione,
sostituito via `fileReplacements`):

```ts
export const environment = {
  production: false,
  useMock: false,                         // true → mock in-memory, nessun backend
  apiUrl: '',                             // vuoto in dev: ci pensa il proxy
  socketUrl: 'http://localhost:3000',     // il namespace /auction lo aggiunge il service
};
```

Il proxy dev è in `proxy.conf.json` (`/rules`, `/players`, `/participants`, `/auction` con
`ws: true`) e `npm start` lo usa già.

## REST (admin & setup)

| Metodo | Path                          | Auth (`x-admin-token`) | Scopo |
|--------|-------------------------------|------------------------|-------|
| GET    | `/health`                     | no  | healthcheck / keep-warm |
| GET    | `/rules`                      | no  | config lega corrente |
| PUT    | `/rules`                      | sì  | aggiorna regole |
| PUT    | `/rules/turn-order`           | sì  | `{ turnOrder: string[] }` |
| POST   | `/players/import`             | sì  | multipart `file` = xlsx Fantacalcio.it |
| GET    | `/players?role=&q=&available=&taken=&take=` | no | ricerca calciatori — **ordinati per quotazione DESC**, con `taken`. `available=true` = solo i liberi, `taken=true` = solo i venduti (Regia); se arrivano entrambi vince `available` |
| GET    | `/players/last-import`        | no  | `{ filename, at, count }` dell'ultimo import |
| GET    | `/participants`               | no  | lista con rose; `accessCode` e `magicToken` **solo** col token admin |
| POST   | `/participants`               | sì  | crea partecipante (body `{}` ammesso) → lista aggiornata |
| PATCH  | `/participants/:id`           | sì  | aggiorna → lista aggiornata. `avatarUrl` è un URL esterno `http(s)` a un'immagine (niente upload, niente storage): `""` la toglie, un `data:` URI o un URL senza schema è `400` |
| DELETE | `/participants/:id`           | sì  | rimuovi → lista aggiornata |
| POST   | `/participants/reset-auction` | sì  | reset asta (rose, budget, reparti chiusi) |
| POST   | `/participants/:id/regenerate-code` | sì | nuovo codice d'accesso → partecipante. Revoca anche le sessioni aperte di quella squadra |
| POST   | `/participants/:id/regenerate-link` | sì | nuovo magic link → partecipante. Idem: il link vecchio e le sessioni cadono |
| GET    | `/log?take=&before=&type=&participantId=` | no | telecronaca, la più recente in testa. `type` è una lista (`nominate,bid`) o l'alias `purchases`; `before=<seq>` è il cursore di pagina |
| GET    | `/export/rosters`             | sì  | `{ filename, csv, skipped[] }` — rose per Fantacalcio.it |
| GET    | `/export/rosters.csv`         | sì  | stesso file, come download (`Content-Disposition`) |

Ogni scrittura riallinea lo stato live del gateway e ritrasmette `state`: l'admin non ha
bisogno di ricaricare la pagina.

### Export delle rose per Fantacalcio.it

CSV a tre colonne senza intestazione — `nomeSquadra,idCalciatore,prezzo` — con una riga
separatore `$,$,$` **prima** di ogni blocco-squadra, incluso il primo. `idCalciatore` è
l'`Id` del listone Fantacalcio.it (`Player.externalId`), **non** il nostro `playerId`:
esporta solo chi è arrivato dall'import xlsx. Le rose escono in ordine di creazione delle
squadre, e dentro ogni blocco per prezzo crescente. File di riferimento:
`resources/fanta-asta-live-rosters-1785180073624.csv`.

La Regia usa la rotta **JSON**, non il download diretto: `skipped[]` elenca gli acquisti
rimasti fuori (calciatori senza `externalId`, tipicamente assegnati a mano o da un seed) e
l'admin deve saperlo, il file lo confeziona il client da `csv`. L'export è in sola lettura:
si può rifare a ogni momento, anche ad asta in corso.

## Realtime (Socket.IO, namespace `/auction`)

Il **timer vive sul server**: `endsAt` (timestamp assoluto) è la verità, `tick` serve solo
all'animazione. Eventi come in `../CLAUDE.md` §5.

Client → server: `auth`, `nominate`, `bid`, `claim`, `release`, `unrelease`, `admin:start`,
`admin:pause`, `admin:resume`, `admin:skipTurn`, `admin:assignManual`, `admin:advanceRole`,
`admin:reopenLot`, `admin:startRepair`.
Server → client: `state`, `turn`, `nominated`, `bid`, `tick`, `assigned`, `released`,
`budgetUpdated`, `errorMsg`, `finished`. La telecronaca **non** ha un evento suo: viaggia dentro
`state.log` (la coda recente), e la storia si chiede a `GET /log`.

Il client tiene lo stato **solo** da `state`: gli altri eventi arrivano sempre accompagnati
da uno snapshot, quindi servono per animazioni e suoni, non per mutare lo stato.

### Contratto allineato al gateway

`src/app/core/auction-events.ts` e `../backend/src/auction/dto/events.ts` sono **lo stesso
contratto**, campo per campo (`PLAN.md` decisioni 5 e 6, chiuse). Due conseguenze pratiche:

- **`auth` risponde con un ack** `{ ok, isAdmin, participantId, session? }`: il client non
  inferisce chi è. In caso di rifiuto l'ack porta `code`/`message` e arriva anche un `errorMsg`.
- **`accessCode` e `magicToken` non escono** verso i client non-admin: il gateway costruisce
  due snapshot, uno per la stanza degli admin e uno per tutti gli altri. La tab Lega vede le
  credenziali perché l'admin è autenticato sul socket, non perché il client le chieda.

Se tocchi il contratto, aggiorna nello stesso PR i due file dei tipi, `CLAUDE.md` §5 e
questo README.

### Accesso e sessione

Si entra da `/j/<magicToken>`: `MagicLinkPage` fa `auth` col token e va in sala, poi
**cancella il token dall'URL** (`replaceUrl`) — non deve restare nella cronologia né in uno
screenshot girato al gruppo. L'accesso a mano (`/`) resta per chi il link l'ha perso e per
l'admin.

Cosa vive dove:

- `SessionStore` salva in `localStorage` **solo** il JWT di sessione che arriva nell'ack
  (`fantasta.session`). Mai il magic token, mai il codice, mai l'`ADMIN_TOKEN`: sono
  credenziali durevoli o condivise, restano dove l'admin le ha mandate.
- `AuctionStore.init()` è il punto d'avvio unico e memoizzato: aggancia i listener, apre la
  socket e **riprende** la sessione salvata. Le guard di rotta la aspettano (`joined.guard.ts`),
  altrimenti ricaricare su `/asta` rimbalzerebbe all'accesso un istante prima della risposta
  del server. Se il server non risponde entro `RESUME_TIMEOUT_MS` si mostra l'accesso e la
  sessione resta salvata per il tentativo dopo.
- Su **riconnessione** il client si ripresenta da solo: la sessione del server viveva sulla
  socket caduta, quindi all'evento `connect` si rimanda `auth` con la credenziale in mano.
- `SESSION_EXPIRED` (scaduta, o credenziali rigenerate dall'admin) è l'unico caso in cui il
  client butta quel che ha salvato e torna all'accesso.

## Design system — **Prato**

Tutti i colori, i font, gli spazi e i raggi vengono dai token in `src/styles.scss`
(`--color-*`, `--role-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`). Per ritoccare
il look si cambiano i token, **non** i componenti: nei template non c'è un solo hex.

Verde campo come fondo (strisce di taglio d'erba + luce dei riflettori sul `body`, `fixed`
sotto allo scroll), **lime** da segnaletica come accento e **giallo** da cartellino come
secondo. Regole:

- Il lime è una **campitura**, non solo una linea: i bottoni di rilancio e la tab attiva sono
  pieni, e allora il testo sopra è sempre scuro (`--color-bg`). Mai lime su lime.
- Il **rosso-arancio** (`--color-urgent`) è riservato agli **ultimi 3 secondi** di un lotto.
  Non è il colore degli errori: un rifiuto del server non è un'emergenza, e se il rosso
  comparisse anche lì smetterebbe di voler dire «stai per perdere il giocatore». I crediti agli
  sgoccioli usano il giallo.
- I ruoli hanno i colori classici del fantacalcio (`--role-p/d/c/a`), tinta piena con il
  proprio `-fg` scuro: il reparto si riconosce senza leggere la lettera.
- Titoli in **Bricolage Grotesque** (`--font-display`), peso 700/800 e `letter-spacing`
  negativo, solo su: titolo dell'asta, nome del calciatore in asta, cifra dell'offerta, timer,
  bottoni di rilancio, «Tocca a te», nome squadra e crediti nella Rosa, label di nav e tab.
  Il corpo è **Plus Jakarta Sans** — un display su un paragrafo stanca. Tutto ciò che è
  numerico va in `tabular-nums`, altrimenti le cifre ballano a ogni tick.
- Animazioni: cinque keyframes globali (`rilPulse`, `rilPop`, `rilRise`, `rilBlink`,
  `rilGlow`), solo `transform`/`opacity`/`box-shadow`. Un'animazione CSS non si ri-innesca se
  l'elemento resta lo stesso: dove serve ripartire a ogni cambio (cifra dell'offerta, card del
  lotto) il nodo si **ricrea** con `@for` su una lista di un elemento e `track` sul valore.
  Con `prefers-reduced-motion` le durate crollano e le **infinite si spengono** del tutto.

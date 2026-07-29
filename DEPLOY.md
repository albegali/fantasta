# DEPLOY.md — Procedura guidata, dal nulla all'app online

> Guida operativa da seguire col browser aperto. Il **perché** di ogni scelta
> (confronto dei tier gratuiti, limiti, rischi) è in [`INFRA.md`](./INFRA.md): qui
> ci sono solo i click, i valori da incollare e le verifiche.
>
> **Tempo**: ~45 minuti la prima volta, di cui metà d'attesa delle build.
> **Costo**: 0 €. **Carta di credito**: non serve su nessuno dei tre servizi.

## Quello che stai per costruire

| Pezzo | Servizio | Cosa diventa |
|---|---|---|
| Database | **Neon** | Postgres gestito, si spegne da solo quando non lo usi |
| Backend | **Render** | NestJS + Socket.IO, `https://<nome>.onrender.com` |
| Frontend | **Cloudflare Workers** (static assets) | l'app Angular, `https://<nome>.<subdomain>.workers.dev` |
| Sveglia | **cron-job.org** | ping su `/health` per non farlo addormentare in serata |

Tieni aperto un file di note: durante la procedura raccogli **5 valori** che serviranno
dopo (URL backend, URL frontend, `ADMIN_TOKEN`, `JWT_SECRET`, stringa Neon).

---

## Passo 0 — GitHub (fatto)

Il repo è su GitHub: è da lì che Render e Cloudflare pescano il codice. Può restare
**privato**: entrambi chiedono l'autorizzazione al momento del collegamento.

- [x] Repo pushato su `main`
- [ ] Se hai commit locali non pushati (es. il fix dotenv), pushali **adesso**: le
      piattaforme costruiscono quel che vedono su GitHub, non quel che hai sul Mac.

```bash
git status --short   # deve essere vuoto
git log origin/main..HEAD --oneline   # deve essere vuoto
```

---

## Passo 1 — Database su Neon (~5 min)

1. Vai su **[neon.com](https://neon.com)** → *Sign up* → conviene **Continue with
   GitHub** (nessuna password nuova, nessuna carta).
2. Al primo accesso Neon propone di creare un progetto:
   - **Project name**: `fantasta-auction`
   - **Postgres version**: la default
   - **Region**: una **europea** — *Europe (Frankfurt)* se c'è. Deve stare vicino al
     backend, che metteremo a Frankfurt: ogni query dell'asta fa avanti-e-indietro.
   - **Create project**
3. Neon apre il pannello **Connection string**. Qui c'è l'unico passaggio delicato:
   - se vedi un interruttore **Connection pooling**, **spegnilo**;
   - guarda l'host della stringa: **non deve contenere `-pooler`**.
     ✅ `...@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb`
     ❌ `...@ep-cool-name-123456**-pooler**.eu-central-1.aws.neon.tech/neondb`
   - se manca, aggiungi `?sslmode=require` alla fine.

   > Perché senza pooler: siamo **un** processo Node long-lived, non mille funzioni
   > serverless; e `prisma migrate deploy` non passa attraverso pgBouncer. Dettagli
   > in `INFRA.md` §5.
4. **Copia la stringa nelle note.** È una password: non finisce in nessun file del repo.

Non devi creare tabelle: le crea il backend al primo avvio con `prisma migrate deploy`.

---

## Passo 2 — Backend su Render (~15 min, quasi tutta attesa)

1. **[render.com](https://render.com)** → *Get Started* → **GitHub**. Il piano free non
   chiede la carta (se te la chiede, stai selezionando un instance type a pagamento).
2. In alto a destra: **New** → **Blueprint**.
3. Se è il primo collegamento, Render chiede l'accesso a GitHub: **Install & Authorize**
   (puoi limitarlo al solo repo `fantasta`).
4. Seleziona il repo → **Connect**.
   - **Blueprint name**: `fantasta-auction`
   - **Branch**: `main`
   - **Blueprint Path**: lascia `render.yaml` (è nella root del repo)
5. Render mostra le risorse che creerà — deve comparire **un** web service,
   `fantasta-auction-api`, piano **Free**.
   > ⚠️ Se il nome è già preso da qualcun altro, Render aggiunge un suffisso: l'URL
   > finale cambia e lo sistemiamo al Passo 4. Prendi nota di quello vero.
6. Render chiede i valori delle variabili marcate `sync: false`:

   | Variabile | Cosa incollare |
   |---|---|
   | `DATABASE_URL` | la stringa Neon del Passo 1 |
   | `FRONTEND_ORIGIN` | `http://localhost:4200` — provvisorio, si corregge al Passo 4 |

   `ADMIN_TOKEN` e `JWT_SECRET` **non te li chiede**: li genera lui.
7. **Deploy Blueprint**. La prima build dura ~3-5 minuti (`npm ci`, `prisma generate`,
   `nest build`). Nei log devi vedere, in quest'ordine:
   - `Build successful`
   - le migrazioni applicate (`5 migrations found` → `applied`)
   - `Nest application successfully started`
   - `Fantasta Auction API sulla porta 10000 — origin: http://localhost:4200`
8. **Prendi i due segreti generati**: nel servizio → tab **Environment** → rivela e copia
   `ADMIN_TOKEN` (è la tua password d'admin, la userai ogni serata) e `JWT_SECRET`
   (non serve a te, serve sapere che esiste: cambiarla scollega tutti i telefoni).
9. Copia l'URL del servizio (in alto, tipo `https://fantasta-auction-api.onrender.com`)
   e verifica dal terminale:

```bash
curl -s https://<TUO-BACKEND>.onrender.com/health
# atteso: {"status":"ok","ts":...}
```

> La prima chiamata dopo 15 minuti di silenzio può prendersi **fino a un minuto**:
> è lo spin-down del piano free, non un errore. Riprova e risponde subito.

> **Se cambi `render.yaml`** più avanti: l'*Auto Sync* è attivo per default, quindi basta
> pushare su `main` e Render riapplica il blueprint e ridistribuisce da sé. I valori
> `sync: false` già inseriti (e i segreti generati) **non** vengono toccati.

---

## Passo 3 — Frontend su Cloudflare Workers (~10 min)

> Cloudflare ha unificato **Pages dentro Workers**: la schermata di setup dice
> *"Configure your Worker project"* e il deploy avviene con `npx wrangler deploy`.
> Non è il vecchio flusso Pages e la configurazione **non** sta nel dashboard: sta in
> `frontend/wrangler.jsonc`, che è già nel repo. Assicurati di averlo pushato prima di
> premere Deploy, altrimenti `wrangler` non trova niente da pubblicare.

1. **[dash.cloudflare.com](https://dash.cloudflare.com)** → *Sign up* (email +
   password, nessuna carta).
2. Menu laterale **Workers & Pages** → **Create** → **Import a repository** →
   autorizza GitHub (**Install & Authorize**) e scegli `albegali/fantasta`.
3. In *Set up your application* compila così — valori verificati sulla build reale e
   con `wrangler deploy --dry-run`, non indovinati:

   | Campo | Valore |
   |---|---|
   | Project name | `fantasta-auction` |
   | Build command | `npm ci --include=dev && npm run build` |
   | Deploy command | `npx wrangler deploy` (già giusto di default) |
   | Builds for non-production branches | **togli la spunta** (lavori solo su `main`: build minuti risparmiati) |
   | **Advanced settings** → Root directory | `frontend` |
   | **Advanced settings** → Environment variables | `NODE_VERSION` = `22` |

   > `--include=dev` per la stessa ragione che ha fatto fallire il primo deploy del
   > backend: se il builder imposta `NODE_ENV=production`, `npm ci` salta le
   > devDependencies — e `@angular/build` e la CLI Angular stanno lì.

4. **Deploy**. ~2-3 minuti. L'URL finale è del tipo
   `https://fantasta-auction.<tuo-subdomain>.workers.dev` (Workers, non `pages.dev`):
   se Cloudflare ti chiede di scegliere il **subdomain workers.dev** dell'account,
   fallo ora e non cambiarlo più — ci finisce dentro ogni magic link.
5. Apri l'URL: l'app mostra la schermata d'accesso. Il login **non funzionerà ancora**
   — normale, il backend non conosce ancora questo dominio. **Copia l'URL nelle note.**

> Il fallback SPA qui non viene da `_redirects` (quello vale su Pages e Netlify) ma da
> `"not_found_handling": "single-page-application"` in `wrangler.jsonc`. È ciò che fa
> funzionare un magic link aperto da zero invece di dare 404.

---

## Passo 4 — Far parlare i due mondi (~5 min)

Due modifiche simmetriche: il backend deve *accettare* il dominio del frontend, il
frontend deve *sapere* dov'è il backend.

**4a. Sul backend (dashboard Render)** → servizio → **Environment** → modifica
`FRONTEND_ORIGIN`:

```
https://fantasta-auction.<subdomain>.workers.dev,http://localhost:4200
```

Virgole senza spazi, nessuno slash finale (lo tollera comunque). Il `localhost` in
lista serve a te: ti permette di debuggare in locale contro il backend vero.
**Save** → Render fa un redeploy automatico (~2 min).

**4b. Sul frontend (nel repo)** → `frontend/src/environments/environment.prod.ts`:
metti l'URL **vero** del backend in `apiUrl` e `socketUrl` (se il nome del servizio
Render è quello previsto, il file è già corretto così com'è), poi commit e push.
Cloudflare ribuilda da sé.

**Verifica che il cerchio sia chiuso** (sostituisci i due domini):

```bash
# 1. il backend accetta il dominio del frontend
curl -s -o /dev/null -D - -X OPTIONS https://<BACKEND>/rules \
  -H "Origin: https://<FRONTEND>" -H "Access-Control-Request-Method: PUT" \
  | grep -i access-control-allow-origin
# atteso: Access-Control-Allow-Origin: https://<FRONTEND>

# 2. il canale realtime risponde
curl -s "https://<BACKEND>/socket.io/?EIO=4&transport=polling" -H "Origin: https://<FRONTEND>"
# atteso: 0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,...}

# 3. l'admin entra
curl -s -H "x-admin-token: <ADMIN_TOKEN>" https://<BACKEND>/rules | head -c 120
# atteso: il JSON delle regole di lega
```

Se tutte tre rispondono, l'infrastruttura è in piedi.

---

## Passo 5 — La sveglia (cron keep-warm, ~5 min)

Serve perché il piano free spegne il servizio dopo 15 minuti senza traffico. A sala
aperta i client lo tengono sveglio da soli, ma in una pausa lunga — tutti col telefono
bloccato — si spegnerebbe **portandosi via il lotto aperto**.

1. **[cron-job.org](https://cron-job.org)** → *Sign up* (gratis).
2. **Create cronjob**:
   - **Title**: `fantasta keep-warm`
   - **URL**: `https://<BACKEND>/health`
   - **Schedule**: *Every 10 minutes*
   - **Enabled**: **NO** — lascialo spento
3. Accendilo **2 ore prima** di ogni serata d'asta, spegnilo il giorno dopo.

> Perché non 24/7: Render dà 750 ore/mese e un servizio sempre acceso ne consuma 730,
> senza margine; e un backend sempre sveglio tiene sveglio il compute Neon, che ha
> 100 CU-h/mese. Un cron dimenticato acceso ti fa finire le quote a metà stagione.

---

## Passo 6 — Collaudo prima della serata vera (~15 min)

Fallo **qualche giorno prima**, non la sera stessa.

1. **Login admin**: apri il frontend, spunta *entra come admin*, incolla `ADMIN_TOKEN`.
2. **Listone**: tab *Listone* → carica l'xlsx di Fantacalcio.it (ce n'è un esempio in
   `resources/`). Verifica il conteggio dei calciatori importati.
3. **Regole**: tab *Regole* → budget, slot di rosa, `bidTimerSeconds`, ordine di chiamata.
4. **Squadre**: tab *Lega* → crea i partecipanti, poi copia un **magic link**.
5. **Prova a due dispositivi**: apri il magic link **sul telefono** (rete mobile, non
   il tuo WiFi: è la condizione vera della serata) e tieni la Regia sul portatile.
   Fai una chiamata, un rilancio, aspetta la scadenza del timer.
   Devi vedere: countdown fluido, rilancio che resetta il timer, assegnazione, crediti
   aggiornati, riga in *Storia*.
6. **Azzera**: `POST /participants/reset-auction` (o il bottone in Regia) per ripulire
   la prova, poi ricrea le squadre definitive.

> Il magic link contiene il dominio: se un domani cambi il dominio del frontend, i
> link salvati in chat **non funzionano più** e vanno rigenerati per tutti. Scegli il
> nome del progetto (e il subdomain workers.dev) una volta e non toccarlo (`INFRA.md` §4).

---

## Dove tenere i segreti

| Segreto | Dove vive | Se lo perdi |
|---|---|---|
| `ADMIN_TOKEN` | dashboard Render → Environment | lo rileggi da lì |
| `JWT_SECRET` | dashboard Render → Environment | cambiarlo scollega i telefoni, i link restano |
| Stringa Neon | dashboard Neon | la rigeneri dal pannello Connection |
| Magic link squadre | tab *Lega* dell'admin | `regenerate-link` per quella squadra |

Nessuno dei quattro deve finire nel repo o in una chat di gruppo. `ADMIN_TOKEN`
mandalo a te stesso, non nel gruppo dell'asta.

---

## Se qualcosa non va

| Sintomo | Causa quasi certa | Cosa fare |
|---|---|---|
| La prima apertura gira a vuoto ~1 min | spin-down del piano free | aspetta, o accendi il cron 2 ore prima |
| Frontend su, ma il login non risponde | `FRONTEND_ORIGIN` non contiene il dominio del frontend | Passo 4a, e ricontrolla la virgola |
| Console del browser: *blocked by CORS policy* | idem | idem |
| Il magic link aperto da zero dà **404** | manca il fallback SPA | su Workers serve `"not_found_handling": "single-page-application"` in `frontend/wrangler.jsonc`; su Pages/Netlify serve `frontend/public/_redirects` |
| L'app carica ma il countdown non parte | il socket non si connette | verifica il test 2 del Passo 4; `socketUrl` in `environment.prod.ts` deve essere **https**, non http |
| Build Render: `sh: 1: nest: not found` | `NODE_ENV=production` fa omettere a npm le devDependencies, dove sta `@nestjs/cli` | il `buildCommand` in `render.yaml` deve avere **`npm ci --include=dev`** |
| Deploy Render fallito su `prisma migrate deploy` | `DATABASE_URL` col pooler o senza SSL | usa la stringa **diretta** + `?sslmode=require` (Passo 1) |
| *Out of memory* nei log Render | 512 MB stretti | aggiungi `NODE_OPTIONS=--max-old-space-size=400` fra le env |
| Il DB risponde `password authentication failed` dopo mesi | progetto Neon ruotato/sospeso | rigenera la stringa dal dashboard Neon e aggiornala su Render |
| A metà asta la sala torna a `IDLE` | il backend è ripartito (spin-down o deploy) | il lotto si ribatte; tieni il cron acceso e non pushare in serata |

---

## Checklist della serata

- [ ] Cron keep-warm **acceso** 2 ore prima
- [ ] Aperta l'app e fatto login admin (paghi tu il cold start, non gli altri)
- [ ] Listone importato e verificato
- [ ] Squadre create, magic link mandati uno per uno (non nel gruppo)
- [ ] `ADMIN_TOKEN` a portata di mano
- [ ] **Nessun push su `main`** fino a fine asta
- [ ] Il giorno dopo: esporta le rose (`GET /export/rosters.csv`) e spegni il cron

# INFRA.md — Infrastruttura & Deploy a costo ~0

> Obiettivo: far girare l'app **gratis**, sapendo che serve **realtime persistente**
> (Socket.IO) per l'asta. L'uso è concentrato in poche serate l'anno, quindi
> cold-start e spin-down sono accettabili — a patto di scaldare il servizio prima.
>
> Dati dei tier gratuiti **verificati a luglio 2026**. Cambiano spesso: ricontrolla
> le fonti in fondo prima di un deploy nuovo.

## 1. Il vincolo che decide l'architettura

Non è "hostare Node gratis": è che il backend è **un processo unico con stato in
memoria e timer** (`auction.service.ts`: `tickInterval`, lo stato live, la coda di
serializzazione `run()`). Da qui, tre esclusioni non negoziabili:

| Cosa è escluso | Perché |
|---|---|
| **Serverless puro** (Vercel/Netlify Functions, Lambda) | niente connessioni long-lived: il socket non sopravvive |
| **Multi-replica / autoscaling** | due istanze = due timer e due stati divergenti. Serve *single instance* per contratto, non per risparmio |
| **Scale-to-zero durante l'asta** | il processo che muore a metà si riporta dietro il lotto aperto (decisione 17 in `PLAN.md`) |

Cloud Run supporta i WebSocket ma dichiara la session affinity *best effort*: con
lo stato in memoria è una roulette. Fuori per lo stesso motivo.

## 2. Panorama dei tier gratuiti (luglio 2026)

| Piattaforma | Stato | Ruolo |
|---|---|---|
| **Render** free web service | 750 h/mese per workspace, 512 MB / 0.1 CPU, **istanza singola**, spin-down 15', cold start ~1 min, nessuna carta | ✅ **backend** |
| **Cloudflare Pages** | banda **illimitata**, 500 build/mese, uso commerciale permesso | ✅ **frontend** |
| **Neon** free | 0.5 GB per progetto, 100 CU-h/mese, scale-to-zero a 5', wake < 500 ms | ✅ **database** |
| Vercel Hobby | 100 GB/mese, **solo uso non commerciale**, 1 sviluppatore | alternativa frontend |
| Netlify free | 100 GB, 300 build-min | alternativa frontend |
| Supabase free | 500 MB, ma **progetto in pausa dopo 1 settimana di inattività**, riattivazione **manuale** dal dashboard | ⚠️ scomodo per un uso di 2 serate l'anno |
| Render Postgres free | 1 GB ma **scade 30 giorni dopo la creazione** (+14 di grazia, poi cancellato) | ❌ inutilizzabile qui |
| Fly.io | **free tier abolito nel 2024**, restano $5 di trial | ❌ |
| Railway | $1 di credito/mese, i servizi si fermano a credito esaurito | ❌ |
| Cloudflare Workers + Durable Objects | free reale (100k req/giorno, WebSocket Hibernation) e nativamente realtime | ❌ richiederebbe riscrivere NestJS + Prisma + Socket.IO |
| Oracle Cloud Always Free | 2 OCPU / 12 GB ARM **always-on**, 200 GB disco, 10 TB egress | ⚠️ vedi §7 |

## 3. Architettura scelta

```
┌─────────────────────────────┐
│ Angular 22 (statico)        │
│ Cloudflare Pages            │
└──────────┬──────────────────┘
           │ HTTPS (REST) + WSS (Socket.IO)
┌──────────▼──────────────────┐        ┌──────────────────────┐
│ NestJS + Socket.IO          │◀───────│ cron-job.org         │
│ Render free web service     │  /health│ ping ogni 10 min     │
│ istanza singola, 512 MB     │        │ (solo in serata)     │
└──────────┬──────────────────┘        └──────────────────────┘
           │ Postgres + SSL
┌──────────▼──────────────────┐
│ Neon free (scale-to-zero)   │
└─────────────────────────────┘
```

Costo **0 €**, nessuna carta di credito su nessuno dei tre servizi.

### 3.1 Perché il free tier regge un'asta di 4 ore con 8 persone

Stime sul codice, non generiche:

- **Banda**: uno snapshot `state` a rose piene è ~30 KB (8 partecipanti × 25
  `RosterEntry`, più le `LOG_TAIL` = 25 righe di cronaca). × 8 client × ~1.500-2.000
  eventi in una serata ≈ **400-500 MB**, più ~20 MB di `tick` (250 ms, payload
  minuscolo). Contro i ~100 GB/mese inclusi: irrilevante.
- **CPU**: per rilancio si costruiscono due snapshot (admin + sala, vedi
  `broadcastState`) e si serializzano ~30 KB. Sub-millisecondo: 0.1 CPU basta.
- **RAM**: lo stato live sono decine di KB; il costo è NestJS + Prisma, ~200-280 MB
  RSS. Dentro i 512 MB, ma **è il numero con meno margine**. Se stringe:
  `NODE_OPTIONS=--max-old-space-size=400`.
- **DB**: ~600 calciatori + 200 acquisizioni + qualche migliaio di righe di
  telecronaca = pochi MB su 0.5 GB. 4 ore di asta ≈ 1 CU-h su 100.

**Il dettaglio che rende Render praticabile**: la doc conta come traffico in entrata
*"both HTTP requests and WebSocket messages from existing connections"*. I pong di
Engine.IO arrivano da ogni client ogni ~25 s, quindi **a sala aperta il servizio non
si spegne da solo**. Il cold start è un problema solo *prima* del fischio d'inizio.

## 4. Le tre cose che possono rovinare la serata

1. **Spin-down a sala vuota → lotto perso.** Se durante una pausa tutti bloccano il
   telefono e i socket cadono, 15 minuti di silenzio spengono il processo: al risveglio
   lo stato si ricostruisce dal DB ma il lotto aperto no, e la sala torna a `IDLE`
   (decisione 17). Il **cron keep-warm è obbligatorio**, non un extra: è ciò che di
   fatto neutralizza quella decisione.
2. **Cold start ~1 min.** Si apre l'app 10 minuti prima e si carica il listone.
3. **Redeploy = lotto perso.** Niente push su `main` la sera dell'asta:
   `autoDeployTrigger: commit` fa ripartire il processo.

E un rischio specifico di questo progetto: i **magic link sono durevoli** e l'URL lo
compone il client da `window.location.origin`. Il dominio del frontend va scelto una
volta e **non cambiato tra agosto e gennaio**, altrimenti i link salvati in chat non
aprono più niente alla riparazione. Se deve cambiare: `regenerate-link` per tutti e
nuovo giro di messaggi.

## 5. Variabili d'ambiente (backend)

Vedi `backend/.env.example`; su Render le dichiara `render.yaml`.

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | connection string Neon **diretta**, con `?sslmode=require` |
| `PORT` | la inietta Render |
| `FRONTEND_ORIGIN` | origin del frontend per CORS e Socket.IO. **Accetta più valori separati da virgola** (`src/config/cors.ts`): dominio definitivo + anteprime `*.pages.dev` + `localhost:4200` per debuggare contro il backend vero |
| `ADMIN_TOKEN` | token condiviso dell'admin: header `x-admin-token` sulle REST **e** token di `auth` sul socket. Senza, nessuno diventa admin |
| `JWT_SECRET` | firma le sessioni dei partecipanti. **Obbligatoria: senza, il backend non parte.** Cambiarla scollega tutti i telefoni, i magic link restano validi |

**Perché la stringa diretta e non il pooler di Neon.** Il pooler (pgBouncer) serve al
caso opposto al nostro: tante funzioni effimere che aprono una connessione a testa. Noi
siamo **un processo unico e long-lived** con il suo pool Prisma, e 8 utenti. In più
`prisma migrate deploy` non funziona attraverso pgBouncer: passare al pooler
richiederebbe aggiungere `directUrl` nel `datasource` di `schema.prisma`.

Il timer di rilancio **non** è una env: è la regola di lega `bidTimerSeconds`
(`PUT /rules`), perché l'admin la cambia a serata in corso.

## 6. Deploy step-by-step

> Questa è la sequenza in sintesi. Per la procedura guidata — creazione degli account,
> ogni campo dei dashboard, verifiche e troubleshooting — vedi [`DEPLOY.md`](./DEPLOY.md).

Prerequisito: il repo su **GitHub** (Render e Cloudflare Pages deployano da lì).

1. **Database — Neon.** Nuovo progetto, regione europea (la stessa area di Render:
   meno latenza per query). Copia la connection string **diretta** (non `-pooler`),
   aggiungi `?sslmode=require`.
2. **Backend — Render.** New → **Blueprint** → punta al repo: legge `render.yaml`
   (root `backend/`, piano free, health check `/health`, Node pinnato da
   `.node-version`). Render chiede i valori `sync: false`:
   - `DATABASE_URL` → la stringa Neon;
   - `FRONTEND_ORIGIN` → per ora `http://localhost:4200`, si corregge al punto 4;
   - `ADMIN_TOKEN` e `JWT_SECRET` li **genera Render**: leggili dal dashboard e
     conserva `ADMIN_TOKEN`, è la password dell'admin.

   Le migrazioni girano allo start (`prisma migrate deploy`). **Niente seed in
   produzione**: la lega nasce al primo avvio (`ensureLeague`), le squadre le crea
   l'admin dalla tab Lega, il listone si carica con `POST /players/import`.
3. **Frontend — Cloudflare Pages.** New → Pages → connetti il repo:
   - root directory: `frontend`
   - build command: `npm ci && npm run build`
   - output directory: `dist/frontend/browser`

   Il fallback SPA è `frontend/public/_redirects` (`/* /index.html 200`), necessario
   perché `/j/<magicToken>` e `/storia` esistono solo nel router Angular.
4. **Chiudi il cerchio degli origin.** Metti l'URL definitivo di Pages in
   `FRONTEND_ORIGIN` su Render (redeploy automatico) e in
   `frontend/src/environments/environment.prod.ts` (`apiUrl` e `socketUrl` =
   URL del backend Render), poi commit → Pages ribuilda.
5. **Keep-warm.** Su [cron-job.org](https://cron-job.org) (gratis): `GET
   <backend>/health` ogni 10 minuti, **abilitato solo intorno alle serate d'asta**.
   Due ragioni per non lasciarlo sempre acceso: le 750 h/mese di Render coprono a
   malapena un servizio 24/7 (730 h) e non lasciano margine per un secondo servizio;
   e un backend sempre sveglio tiene sveglio anche il compute Neon, che ha 100 CU-h/mese.
   Tieni d'occhio le CU-h nel dashboard Neon dopo la prima serata.

### Checklist pre-serata

- [ ] Cron keep-warm abilitato **2 ore prima**.
- [ ] Aprire l'app e fare login admin (paga il cold start prima che arrivino gli altri).
- [ ] Listone importato e verificato (`GET /players/last-import`).
- [ ] Squadre create, magic link inviati.
- [ ] Nessun deploy in coda su `main`.

## 7. Alternativa: Oracle Cloud Always Free (e perché non è la scelta)

Sulla carta vince: 2 OCPU / 12 GB ARM **always-on** (1.500 OCPU-h/mese), Postgres
sulla stessa macchina, 10 TB di egress, zero cold start.

Il problema è la policy ufficiale di reclaim: Oracle si riprende un'istanza Always Free
se **per 7 giorni** CPU (95° percentile), rete e memoria stanno **sotto il 20%**. Un'app
usata due serate l'anno è esattamente quel profilo: ti tocca riaccendere la VM a mano
prima dell'asta — cioè lo stesso cold start di Render, ma con TLS, systemd, backup e
Postgres da gestire tu. Più la lotteria dell'*out of host capacity* e la verifica con
carta al signup.

Per un uso concentrato in poche serate lo **scale-to-zero non è un compromesso: è il
modello giusto**. Oracle diventa interessante solo se l'app inizia a girare in continuo.

## 8. Alternative già valutate e scartate

- **Supabase all-in** (realtime gestito + Edge Functions): sposterebbe la logica d'asta
  fra client, funzioni e DB, e soprattutto non ha timer nativi — il timer
  server-authoritative è il cuore del dominio. Da scartare anche come solo database, per
  la pausa dopo 1 settimana di inattività con riattivazione manuale.
- **Firebase**: realtime nativo, ma le Cloud Functions vogliono il piano Blaze (carta) e
  Firestore è un modello dati poco naturale per listone/rose/quotazioni.
- **Cloudflare Durable Objects**: tecnicamente l'incastro migliore (uno DO = una lega,
  stato e timer nell'oggetto, WebSocket Hibernation, tutto nel free tier) e vale la pena
  ricordarlo. Ma vorrebbe dire riscrivere backend, ORM e trasporto: non si paga in euro,
  si paga in settimane.

## 9. Costi

| Componente | Servizio | Costo | Note |
|---|---|---|---|
| Frontend | Cloudflare Pages | €0 | banda illimitata, 500 build/mese |
| Backend | Render free web service | €0 | 750 h/mese, spin-down 15', cold start ~1 min |
| Database | Neon free | €0 | 0.5 GB, 100 CU-h/mese |
| Keep-warm | cron-job.org | €0 | da tenere spento fuori dalle serate |
| **Totale** | | **€0** | nei limiti dei tier gratuiti |

Il primo upgrade sensato, se un giorno il cold start dà fastidio, è il piano a pagamento
entry-level di Render (~7 $/mese): elimina spin-down e cold start e lascia tutto il resto
identico. Nient'altro in questa architettura ha bisogno di soldi.

## 10. Fonti (verificate a luglio 2026)

- [Render — Deploy for Free](https://render.com/docs/free) — 750 h, spin-down 15', WS come traffico in entrata, Postgres free che scade a 30 giorni
- [Render — Platforms with a real free tier in 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Neon — Plans](https://neon.com/docs/introduction/plans) e [Branch archiving](https://neon.com/docs/guides/branch-archiving)
- [Neon — Connect from Prisma](https://neon.com/docs/guides/prisma) — pooler e `directUrl`
- [Oracle — Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) — allowance A1 e policy di reclaim
- [Cloud Run — Using WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) e [Session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity)
- [Cloudflare Workers — Pricing](https://developers.cloudflare.com/workers/platform/pricing/) e [Durable Objects — Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)

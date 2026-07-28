# Fantasta Auction ⚽

Mobile web app per gestire in tempo reale l'**asta del fantacalcio**.
Backend **NestJS + Socket.IO + Prisma/Postgres**, frontend **Angular 22**
(generato con Claude Design, in `frontend/`).

## Documenti
- [`CLAUDE.md`](./CLAUDE.md) — contesto, dominio, contratto realtime
- [`AGENTS.md`](./AGENTS.md) — setup, build, test, convenzioni
- [`PLAN.md`](./PLAN.md) — roadmap a fasi
- [`INFRA.md`](./INFRA.md) — deploy zero-cost + realtime

## Quick start (backend)
```bash
docker compose up -d db
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev   # http://localhost:3000  (health: /health)
```

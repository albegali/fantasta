/**
 * Origin ammessi per CORS (REST) e per il gateway Socket.IO: **la stessa lista**
 * per entrambi, perché il frontend parla ai due canali dallo stesso dominio.
 *
 * `FRONTEND_ORIGIN` accetta più origin separati da virgola. Serve perché in
 * produzione non ce n'è uno solo: il dominio definitivo, l'anteprima della
 * piattaforma di hosting (`*.pages.dev`), e il `localhost:4200` di chi debugga
 * contro il backend vero. Senza la lista, l'unico modo di provare un'altra
 * origine sarebbe cambiare la env e fare un redeploy — a serata in corso, no.
 */
export function corsOrigins(): string[] {
  const raw = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';
  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o.length > 0);
  return origins.length > 0 ? origins : ['http://localhost:4200'];
}

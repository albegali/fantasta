export const environment = {
  production: false,
  /**
   * `false` (default) → socket.io-client + REST reali: serve il backend su :3000
   * (`cd backend && npm run start:dev`). `true` → mock in-memory (`core/mock/`):
   * sala viva con avversari simulati, utile per lavorare sulla UI offline.
   */
  useMock: false,
  /** Base REST. Con `npm start` il proxy inoltra /rules, /players, … a :3000. */
  apiUrl: '',
  /** Origin del gateway Socket.IO; il namespace `/auction` è aggiunto dal service. */
  socketUrl: 'http://localhost:3000',
};

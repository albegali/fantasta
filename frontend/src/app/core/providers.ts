import { Provider } from '@angular/core';

import { environment } from '../../environments/environment';
import { createMockBackend } from './mock/mock-backend';
import { ApiPort, SocketPort } from './ports';
import { RestApiAdapter } from './rest-api.adapter';
import { SocketIoAdapter } from './socket.adapter';

/**
 * L'unico punto da toccare per passare dal mock al backend reale
 * (`frontend-handoff.md` §1, §8). `environment.useMock` decide chi risponde:
 * la UI vede sempre `SocketPort` + `ApiPort` e non cambia di una riga.
 */
export function provideAuctionBackend(): Provider[] {
  if (!environment.useMock) {
    return [
      { provide: SocketPort, useClass: SocketIoAdapter },
      { provide: ApiPort, useClass: RestApiAdapter },
    ];
  }

  // Il mock è un singleton condiviso: socket e api parlano con lo stesso "server".
  const backend = createMockBackend({ simulateOpponents: true });
  return [
    { provide: SocketPort, useValue: backend.socket },
    { provide: ApiPort, useValue: backend.api },
  ];
}

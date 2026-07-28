import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

import { environment } from '../../environments/environment';
import { Ack, SocketPort } from './ports';

/**
 * Trasporto realtime reale: `socket.io-client` sul namespace `/auction`.
 * Non contiene logica d'asta — solo `on/off/emit`. Chi decide è il server.
 */
@Injectable()
export class SocketIoAdapter extends SocketPort {
  private readonly socket: Socket = io(`${environment.socketUrl}/auction`, {
    transports: ['websocket'],
    autoConnect: false,
  });

  override connect(): void {
    if (!this.socket.connected) this.socket.connect();
  }

  override disconnect(): void {
    this.socket.disconnect();
  }

  override on<T>(event: string, handler: (payload: T) => void): void {
    this.socket.on(event, handler as (...args: unknown[]) => void);
  }

  override off<T>(event: string, handler: (payload: T) => void): void {
    this.socket.off(event, handler as (...args: unknown[]) => void);
  }

  override emit<A = unknown>(event: string, payload: unknown = {}, ack?: Ack<A>): void {
    if (ack) this.socket.emit(event, payload, ack);
    else this.socket.emit(event, payload);
  }
}

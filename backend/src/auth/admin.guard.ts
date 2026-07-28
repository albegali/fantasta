import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Guard admin minimale: confronta l'header `x-admin-token` con `ADMIN_TOKEN`.
 * Boilerplate: sostituibile con JWT/magic-link in seguito (vedi PLAN.md).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-admin-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!isValidAdminToken(token)) {
      throw new UnauthorizedException('Token admin non valido');
    }
    return true;
  }
}

/**
 * Helper riusabile anche dal gateway socket. Un `ADMIN_TOKEN` non configurato non
 * deve rendere admin chiunque: senza segreto in env nessuno passa.
 */
export function isValidAdminToken(token?: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  return !!expected && !!token && token === expected;
}

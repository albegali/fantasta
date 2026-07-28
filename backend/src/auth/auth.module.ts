import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        // Meglio non partire che partire firmando le sessioni con un segreto vuoto:
        // un backend senza `JWT_SECRET` lascerebbe entrare chiunque con un JWT fatto
        // in casa. Stessa logica di `ADMIN_TOKEN` in `admin.guard.ts`.
        if (!secret) {
          throw new Error(
            'JWT_SECRET mancante: firma le sessioni dei magic link. Vedi backend/.env.example.',
          );
        }
        // La durata la decide `AuthService.issue`: una costante sola per la firma
        // e per l'`expiresAt` che finisce nell'ack.
        return { secret };
      },
    }),
  ],
  providers: [AdminGuard, AuthService],
  exports: [AdminGuard, AuthService],
})
export class AuthModule {}

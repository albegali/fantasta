import { Module, Get, Controller } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PlayersModule } from './players/players.module';
import { ParticipantsModule } from './participants/participants.module';
import { RulesModule } from './rules/rules.module';
import { AuctionModule } from './auction/auction.module';
import { AuthModule } from './auth/auth.module';
import { ExportModule } from './export/export.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', ts: Date.now() };
  }
}

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RulesModule,
    PlayersModule,
    ParticipantsModule,
    AuctionModule,
    ExportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuctionService } from './auction.service';
import { AuctionGateway } from './auction.gateway';
import { AuctionLogService } from './auction-log.service';
import { LogController } from './log.controller';

// `AuthModule` non importa nulla dall'asta: la dipendenza è a senso unico,
// nessun ciclo (AGENTS.md §"Direzione delle dipendenze").
@Module({
  imports: [AuthModule],
  providers: [AuctionService, AuctionGateway, AuctionLogService],
  controllers: [LogController],
  exports: [AuctionService],
})
export class AuctionModule {}

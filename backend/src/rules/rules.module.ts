import { Module } from '@nestjs/common';
import { AuctionModule } from '../auction/auction.module';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  // Le rotte REST notificano l'asta live (mai il contrario: eviterebbe il ciclo).
  imports: [AuctionModule],
  providers: [RulesService],
  controllers: [RulesController],
  exports: [RulesService],
})
export class RulesModule {}

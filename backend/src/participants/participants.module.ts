import { Module } from '@nestjs/common';
import { AuctionModule } from '../auction/auction.module';
import { RulesModule } from '../rules/rules.module';
import { ParticipantsController } from './participants.controller';
import { ParticipantsService } from './participants.service';

@Module({
  imports: [RulesModule, AuctionModule],
  providers: [ParticipantsService],
  controllers: [ParticipantsController],
  exports: [ParticipantsService],
})
export class ParticipantsModule {}

import { Module } from '@nestjs/common';
import { AuctionModule } from '../auction/auction.module';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

@Module({
  imports: [AuctionModule],
  providers: [PlayersService],
  controllers: [PlayersController],
  exports: [PlayersService],
})
export class PlayersModule {}

import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuctionRules } from '../auction/dto/events';
import { AdminGuard } from '../auth/admin.guard';
import { SetTurnOrderDto, UpdateRulesDto } from './dto/update-rules.dto';
import { RulesService } from './rules.service';

/** Config di lega. Torna la forma `AuctionRules` del contratto, non la riga DB. */
@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  get(): Promise<AuctionRules> {
    return this.rules.getRules();
  }

  @Put()
  @UseGuards(AdminGuard)
  update(@Body() dto: UpdateRulesDto): Promise<AuctionRules> {
    return this.rules.updateRules(dto);
  }

  @Put('turn-order')
  @UseGuards(AdminGuard)
  setTurnOrder(@Body() dto: SetTurnOrderDto): Promise<{ turnOrder: string[] }> {
    return this.rules.setTurnOrder(dto.turnOrder);
  }
}

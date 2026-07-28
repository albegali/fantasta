import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Participant } from '../auction/dto/events';
import { AdminGuard, isValidAdminToken } from '../auth/admin.guard';
import { CreateParticipantDto, UpdateParticipantDto } from './dto/participant.dto';
import { ParticipantsService } from './participants.service';

@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participants: ParticipantsService) {}

  /**
   * Lista pubblica (la usa la schermata Accesso per mostrare le squadre). I codici
   * d'accesso escono **solo** se la richiesta porta un token admin valido.
   */
  @Get()
  list(@Headers('x-admin-token') token?: string): Promise<Participant[]> {
    return this.participants.list(isValidAdminToken(token));
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateParticipantDto): Promise<Participant[]> {
    return this.participants.create(dto);
  }

  /** Prima di `:id`, altrimenti "reset-auction" verrebbe letto come un id. */
  @Post('reset-auction')
  @UseGuards(AdminGuard)
  reset(): Promise<{ ok: true }> {
    return this.participants.resetAuction();
  }

  @Post(':id/regenerate-code')
  @UseGuards(AdminGuard)
  regenerateCode(@Param('id') id: string): Promise<Participant> {
    return this.participants.regenerateCode(id);
  }

  /** Nuovo magic link: il vecchio smette di funzionare, le sessioni cadono. */
  @Post(':id/regenerate-link')
  @UseGuards(AdminGuard)
  regenerateLink(@Param('id') id: string): Promise<Participant> {
    return this.participants.regenerateLink(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateParticipantDto): Promise<Participant[]> {
    return this.participants.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string): Promise<Participant[]> {
    return this.participants.remove(id);
  }
}

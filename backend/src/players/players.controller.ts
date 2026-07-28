import {
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlayerRow, Role, ROLES } from '../auction/dto/events';
import { AdminGuard } from '../auth/admin.guard';
import { ImportResult, LastImport, PlayersService } from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  /** Upload del file "Quotazioni" di Fantacalcio.it (campo multipart `file`). */
  @Post('import')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file'))
  import(@UploadedFile() file: Express.Multer.File): Promise<ImportResult> {
    return this.players.importFromXlsx(file);
  }

  /** Dichiarata prima di `@Get()`: è una rotta figlia, non un filtro del listone. */
  @Get('last-import')
  lastImport(): Promise<LastImport> {
    return this.players.lastImport();
  }

  @Get()
  list(
    @Query('role') role?: string,
    @Query('q') q?: string,
    @Query('available') available?: string,
    @Query('taken') taken?: string,
    @Query('take') take?: string,
  ): Promise<PlayerRow[]> {
    const parsedTake = Number.parseInt(take ?? '', 10);
    return this.players.list({
      role: ROLES.includes(role as Role) ? (role as Role) : undefined,
      q,
      onlyAvailable: isTrue(available),
      onlyTaken: isTrue(taken),
      take: Number.isNaN(parsedTake) ? undefined : parsedTake,
    });
  }
}

function isTrue(value?: string): boolean {
  return value === 'true' || value === '1';
}

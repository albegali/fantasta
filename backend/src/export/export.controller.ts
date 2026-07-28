import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { ExportService, RostersExport } from './export.service';

/**
 * Due facce dello stesso export. La UI usa il JSON — le serve la lista degli
 * esclusi da mostrare all'admin, e il file lo confeziona lei da `csv`; la rotta
 * `.csv` è il download diretto, per `curl` o per un link aperto a mano.
 */
@Controller('export')
@UseGuards(AdminGuard)
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  @Get('rosters')
  rosters(): Promise<RostersExport> {
    return this.exporter.rosters();
  }

  @Get('rosters.csv')
  async rostersCsv(@Res({ passthrough: true }) res: Response): Promise<string> {
    const { filename, csv } = await this.exporter.rosters();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}

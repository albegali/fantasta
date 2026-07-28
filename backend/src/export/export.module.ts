import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  providers: [ExportService],
  controllers: [ExportController],
  exports: [ExportService],
})
export class ExportModule {}

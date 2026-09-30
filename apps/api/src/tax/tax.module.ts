import { Module } from '@nestjs/common';
import { CheckInModule } from '../checkin/checkin.module';
import { TaxReportService } from './tax-report.service';
import { TaxReportsEnabledGuard } from './tax-reports-enabled.guard';
import { TaxRulesService } from './tax-rules.service';
import { TaxController } from './tax.controller';

/** Monthly tax estimates and their exports (Phase 5). Shares the PDF renderer with the Fiche. */
@Module({
  imports: [CheckInModule],
  controllers: [TaxController],
  providers: [TaxReportService, TaxRulesService, TaxReportsEnabledGuard],
})
export class TaxModule {}

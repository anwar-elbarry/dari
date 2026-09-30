import { Module } from '@nestjs/common';
import { CheckInModule } from '../checkin/checkin.module';
import { PoliceRegisterEnabledGuard } from './police-register-enabled.guard';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';

/** Monthly police register (Phase 4). Shares the PDF renderer with the Fiche. */
@Module({
  imports: [CheckInModule],
  controllers: [RegisterController],
  providers: [RegisterService, PoliceRegisterEnabledGuard],
})
export class RegisterModule {}

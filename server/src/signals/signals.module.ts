import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { SignalsService } from './signals.service';

@Module({
  imports: [AlertsModule],
  providers: [SignalsService],
  exports: [SignalsService],
})
export class SignalsModule {}

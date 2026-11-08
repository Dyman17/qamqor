import { Module } from '@nestjs/common';
import { FarmsController } from './farms.controller';
import { FarmsService } from './farms.service';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [FarmsController],
  providers: [FarmsService, InvitationsService],
  exports: [FarmsService],
})
export class FarmsModule {}


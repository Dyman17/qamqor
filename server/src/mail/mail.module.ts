import { Global, Module } from '@nestjs/common';
import { ConsoleMailer, MAILER } from './mailer';

@Global()
@Module({
  providers: [{ provide: MAILER, useClass: ConsoleMailer }],
  exports: [MAILER],
})
export class MailModule {}

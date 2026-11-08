import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transport-agnostic mailer. A real provider is the owner's decision; none is bundled. */
export interface Mailer {
  /** 'none' = nothing is really delivered (callers must not pretend otherwise). */
  status(): 'none' | 'configured';
  send(message: MailMessage): Promise<void>;
}

/** Injection token for the active Mailer. */
export const MAILER = 'QAMQOR_MAILER';

/**
 * Development transport: writes the message to the log.
 * In production it logs only recipient and subject (never the token-bearing body) and
 * warns that nothing was delivered, because no real transport is configured.
 */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('Mailer');

  /** Logging to the console counts as delivery only outside production (a developer reads the log). */
  status(): 'none' | 'configured' {
    return process.env.NODE_ENV === 'production' ? 'none' : 'configured';
  }

  async send(message: MailMessage): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        `No mail transport configured: message "${message.subject}" to ${message.to} was NOT delivered`,
      );
      return;
    }
    this.logger.log(`To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
  }
}

import {
  FileMailTransport,
  SmtpTransport,
  type MailTransport,
} from '@nestjs/mail';

export function mailTransport(
  env: NodeJS.ProcessEnv = process.env,
): MailTransport {
  switch (env.MAIL_TRANSPORT ?? 'file') {
    case 'file':
      return new FileMailTransport({
        directory: env.MAIL_DIRECTORY ?? 'var/mail',
      });

    case 'smtp': {
      const url = env.SMTP_URL;

      if (!url) {
        throw new Error('SMTP_URL is required when MAIL_TRANSPORT is "smtp"');
      }

      return new SmtpTransport({
        url,
        pool: true,
      });
    }

    default:
      throw new Error(
        `MAIL_TRANSPORT must be "file" or "smtp" (got "${env.MAIL_TRANSPORT}")`,
      );
  }
}
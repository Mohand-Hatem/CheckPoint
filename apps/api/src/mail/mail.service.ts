import { Injectable } from '@nestjs/common';
import { Mailer } from '@nestjs/mail';

@Injectable()
export class MailService {
  constructor(private readonly mailer: Mailer) {}

  async sendEmployeeInvitation(
    email: string,
    invitationUrl: string,
  ) {
    return this.mailer.send({
      to: email,
      subject: 'Your CheckPoint Employee Invitation',
      html: `
        <h2>Welcome to CheckPoint</h2>
        <p>You have been invited to join CheckPoint.</p>
        <p>
          <a href="${invitationUrl}">Accept Invitation</a>
        </p>
      `,
    });
  }
}
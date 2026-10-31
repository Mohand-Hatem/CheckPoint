import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailModule } from '@nestjs/mail';

@Module({
  imports: [MailModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailFeatureModule {}
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailerService, MailerTestModule, TestMailbox } from '@nestjs-modules/mailer';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

describe('InvitationsService email delivery (TEST-039, AC-REQ-032-05)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';
  const dto = { email: 'Sara@Example.com', fullName: 'Sara Ali', employeeCode: 'EMP-010' };

  let mailbox: TestMailbox;
  let mailer: MailerService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MailerTestModule.register({ defaults: { from: 'CheckPoint <no-reply@checkpoint.test>' } })],
    }).compile();
    mailbox = moduleRef.get(TestMailbox);
    mailer = moduleRef.get(MailerService);
  });

  beforeEach(() => mailbox.clear());

  function createService(env: Record<string, string> = {}) {
    const db: Record<string, any> = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      employee: { findUnique: jest.fn().mockResolvedValue(null) },
      companyInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'invitation-1', email: 'sara@example.com', fullName: 'Sara Ali' }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn(async (op: (tx: unknown) => unknown) => op(db));
    const config = new ConfigService({
      SMTP_HOST: 'smtp.checkpoint.test',
      INVITE_URL_BASE: 'https://app.checkpoint.test/invite',
      ...env,
    });
    const service = new InvitationsService(
      db as unknown as PrismaService,
      new AuditService(db as unknown as PrismaService),
      {} as EmployeesService,
      mailer,
      config,
    );
    return { service, db };
  }

  it('emails the accept link after saving, and returns it to the Admin', async () => {
    const { service, db } = createService();
    const result = await service.create(companyId, adminUserId, dto);

    expect(result.invitationLink).toBe(`https://app.checkpoint.test/invite?token=${result.token}`);
    expect(db.companyInvitation.create.mock.calls[0][0].data.tokenHash).toBe(
      createHash('sha256').update(result.token).digest('hex'),
    );
    expect(result.emailSent).toBe(true);
    expect(mailbox.assertSent({ to: 'sara@example.com' }).text).toContain(result.invitationLink);
  });

  it('keeps the invitation and reports emailSent=false when sending fails', async () => {
    mailbox.failNext(new Error('SMTP down'));
    const result = await createService().service.create(companyId, adminUserId, dto);
    expect(result.id).toBe('invitation-1');
    expect(result.emailSent).toBe(false);
  });

  it('reports emailSent=false when SMTP is not configured', async () => {
    const result = await createService({ SMTP_HOST: '' }).service.create(companyId, adminUserId, dto);
    expect(result.emailSent).toBe(false);
    expect(result.invitationLink).toContain('token=');
  });
});

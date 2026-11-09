import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController (Phase 1: /health)', () => {
  const controller = (queryRaw: jest.Mock) =>
    new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

  it('live answers ok without touching the database', () => {
    const queryRaw = jest.fn();
    expect(controller(queryRaw).live()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('ready answers ok when the database responds', async () => {
    await expect(controller(jest.fn().mockResolvedValue([{ '?column?': 1 }])).ready()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('ready answers 503 when the database is down', async () => {
    await expect(
      controller(jest.fn().mockRejectedValue(new Error('connection refused'))).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

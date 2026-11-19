import { ConfigService } from '@nestjs/config';
import { AbsenceSweepQueue } from './absence-sweep.queue';
import { AbsenceSweepService } from './absence-sweep.service';

describe('Absence sweep queue (05 §12)', () => {
  it('each job runs one sweep and returns its counts', async () => {
    const sweep = { run: jest.fn().mockResolvedValue({ expired: 1, absences: 2, failed: 0 }) };
    const queue = new AbsenceSweepQueue(sweep as unknown as AbsenceSweepService, {} as ConfigService);

    await expect(queue.process()).resolves.toEqual({ expired: 1, absences: 2, failed: 0 });
    expect(sweep.run).toHaveBeenCalledTimes(1);
  });

  it('closes nothing when it never started (no Redis)', async () => {
    const queue = new AbsenceSweepQueue({} as AbsenceSweepService, {} as ConfigService);
    await expect(queue.onModuleDestroy()).resolves.toBeUndefined();
  });
});

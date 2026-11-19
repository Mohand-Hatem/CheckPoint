import { Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { AbsenceSweepService } from './absence-sweep.service';
import { AttendanceModule } from './attendance.module';

export const ATTENDANCE_SWEEPER = 'attendance-sweeper';

/**
 * Every-minute absence sweep on BullMQ (05 §12). All logic lives in AbsenceSweepService.
 * Plain `bullmq` (CommonJS) instead of @nestjs/bullmq 12, which is ESM-only and breaks jest.
 */
@Injectable()
export class AbsenceSweepQueue implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AbsenceSweepQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly sweep: AbsenceSweepService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const connection: ConnectionOptions = {
      host: this.config.get<string>('REDIS_HOST'),
      port: Number(this.config.get('REDIS_PORT', 6379)),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
    this.queue = new Queue(ATTENDANCE_SWEEPER, { connection });
    // One job at a time; a slow run never overlaps the next one on this instance.
    this.worker = new Worker(ATTENDANCE_SWEEPER, () => this.process(), { connection, concurrency: 1 });
    this.worker.on('failed', (_job, error) => this.logger.error(`Absence sweep job failed: ${error.message}`, error.stack));
    // Upsert: one scheduler however often the API restarts or how many instances run.
    // Not awaited: Redis being down must pause the sweeper, never block the API from starting.
    void this.queue
      .upsertJobScheduler(
        'every-minute',
        { every: 60_000 },
        { name: 'sweep', opts: { removeOnComplete: 100, removeOnFail: 500 } },
      )
      .then(
        () => this.logger.log('Absence sweeper scheduled every minute'),
        (error: Error) => this.logger.error(`Absence sweeper not scheduled: ${error.message}`, error.stack),
      );
  }

  async process() {
    const result = await this.sweep.run();
    if (result.failed > 0) this.logger.warn(`Absence sweep: ${result.failed} failure(s), see errors above`);
    return result;
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

/** Loaded only when REDIS_HOST is set (AppModule); Redis is never a source of truth (03 §Redis). */
@Module({
  imports: [AttendanceModule],
  providers: [AbsenceSweepQueue],
})
export class AbsenceSweepQueueModule {}

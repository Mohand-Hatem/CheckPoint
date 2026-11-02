import { Injectable } from '@nestjs/common';

interface FailureRecord {
  count: number;
  resetAt: number;
}

/**
 * Failure-only rate limit: only wrong credentials count, a success clears the counter.
 * shortcut: in memory and per server instance; move to Redis before running more than one instance.
 */
@Injectable()
export class LoginThrottleService {
  readonly maxFailures = 5;
  readonly windowMs = 60 * 1000;
  private readonly failures = new Map<string, FailureRecord>();

  keyFor(request: { ip?: string; socket?: { remoteAddress?: string }; body?: { email?: unknown } }): string {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const email = request.body?.email ? String(request.body.email).toLowerCase() : 'anonymous';
    return `${ip}:${email}`;
  }

  /** Seconds to wait, or 0 when the key is not blocked. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const record = this.failures.get(key);
    if (!record || now >= record.resetAt || record.count < this.maxFailures) {
      return 0;
    }
    return Math.ceil((record.resetAt - now) / 1000);
  }

  recordFailure(key: string, now = Date.now()): void {
    this.sweep(now);
    const record = this.failures.get(key);
    if (!record || now >= record.resetAt) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      record.count += 1;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  /** Keeps the map from growing forever: drop expired entries once it gets large. */
  private sweep(now: number): void {
    if (this.failures.size < 500) return;
    for (const [key, record] of this.failures) {
      if (now >= record.resetAt) this.failures.delete(key);
    }
  }
}

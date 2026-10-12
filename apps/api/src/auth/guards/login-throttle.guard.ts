import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

interface ThrottleRecord {
  count: number;
  resetAt: number;
}

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, ThrottleRecord>();
  private readonly maxAttempts = 5;
  private readonly windowMs = 60 * 1000; // 1 minute

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const email = request.body?.email ? String(request.body.email).toLowerCase() : 'anonymous';
    const key = `${ip}:${email}`;
    const now = Date.now();

    const record = this.attempts.get(key);

    if (record) {
      if (now > record.resetAt) {
        // Window expired, reset counter
        this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
        return true;
      }

      if (record.count >= this.maxAttempts) {
        const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
        throw new HttpException(
          `Too many login attempts. Please try again in ${retryAfterSeconds} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      record.count += 1;
      return true;
    }

    this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    return true;
  }
}

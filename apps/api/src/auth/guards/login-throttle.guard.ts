import {
  applyDecorators,
  CallHandler,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { LoginThrottleService } from './login-throttle.service';

/** Refuses the request (429) while the caller is over the failure limit. */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(private readonly throttle: LoginThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.throttle.keyFor(context.switchToHttp().getRequest());
    const wait = this.throttle.retryAfterSeconds(key);
    if (wait > 0) {
      throw new HttpException(
        `Too many login attempts. Please try again in ${wait} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/** Counts a failure on 400/401 answers and clears the counter on success. */
@Injectable()
export class LoginThrottleInterceptor implements NestInterceptor {
  constructor(private readonly throttle: LoginThrottleService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const key = this.throttle.keyFor(context.switchToHttp().getRequest());
    return next.handle().pipe(
      tap(() => this.throttle.reset(key)),
      catchError((error) => {
        if (error instanceof HttpException && [400, 401].includes(error.getStatus())) {
          this.throttle.recordFailure(key);
        }
        return throwError(() => error);
      }),
    );
  }
}

/** Put on public credential routes (login, invitation accept). */
export const LoginThrottled = () =>
  applyDecorators(UseGuards(LoginThrottleGuard), UseInterceptors(LoginThrottleInterceptor));

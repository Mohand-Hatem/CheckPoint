import { LoginThrottleService } from './login-throttle.service';

describe('LoginThrottleService (failures only)', () => {
  let throttle: LoginThrottleService;
  const key = '1.2.3.4:user@acme.test';
  const t0 = 1_000_000;

  beforeEach(() => {
    throttle = new LoginThrottleService();
  });

  it('builds the key from ip and lower-cased email, with a fallback for anonymous callers', () => {
    expect(throttle.keyFor({ ip: '1.2.3.4', body: { email: 'User@Acme.TEST' } })).toBe(key);
    expect(throttle.keyFor({ socket: { remoteAddress: '9.9.9.9' } })).toBe('9.9.9.9:anonymous');
    expect(throttle.keyFor({})).toBe('unknown:anonymous');
  });

  it('does not block before 5 failures', () => {
    for (let i = 0; i < 4; i++) throttle.recordFailure(key, t0);
    expect(throttle.retryAfterSeconds(key, t0)).toBe(0);
  });

  it('blocks after 5 failures and reports the remaining wait', () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure(key, t0);
    expect(throttle.retryAfterSeconds(key, t0 + 10_000)).toBe(50);
  });

  it('a success (reset) clears the failures', () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure(key, t0);
    throttle.reset(key);
    expect(throttle.retryAfterSeconds(key, t0)).toBe(0);
  });

  it('the block ends when the window passes, and counting starts again', () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure(key, t0);
    expect(throttle.retryAfterSeconds(key, t0 + 60_000)).toBe(0);
    throttle.recordFailure(key, t0 + 61_000);
    expect(throttle.retryAfterSeconds(key, t0 + 61_000)).toBe(0); // one failure in the new window
  });

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure(key, t0);
    expect(throttle.retryAfterSeconds('1.2.3.4:other@acme.test', t0)).toBe(0);
  });

  it('drops expired entries once the map gets large, so it cannot grow forever', () => {
    for (let i = 0; i < 600; i++) throttle.recordFailure(`ip:${i}`, t0);
    throttle.recordFailure('late', t0 + 120_000); // sweep runs, all earlier windows have expired
    expect((throttle as any).failures.size).toBe(1);
  });
});

import { PointType } from '@prisma/client';
import { classifyCheckIn, computeWindows, overtimeGreens } from './attendance-rules';

// Default shift (docs/05 §4.1): 08:00–16:00, early 60, grace 120, red period 240.
const version = {
  startTime: new Date('1970-01-01T08:00:00.000Z'),
  endTime: new Date('1970-01-01T16:00:00.000Z'),
  earlyMinutes: 60,
  graceMinutes: 120,
  redPeriodMinutes: 240,
};

describe('computeWindows (TEST-012)', () => {
  it('turns Cairo wall-clock times into UTC instants in winter (UTC+2)', () => {
    const w = computeWindows(new Date('2026-11-02T00:00:00.000Z'), version, 'Africa/Cairo');
    expect(w.scheduledStartAt.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect(w.earlyEndAt.toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(w.graceEndAt.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(w.redPeriodEndAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(w.scheduledEndAt.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('follows Egyptian summer time (UTC+3)', () => {
    const w = computeWindows(new Date('2026-07-15T00:00:00.000Z'), version, 'Africa/Cairo');
    expect(w.scheduledStartAt.toISOString()).toBe('2026-07-15T05:00:00.000Z');
  });
});

describe('classifyCheckIn (TEST-012, REQ-012 boundaries)', () => {
  const w = computeWindows(new Date('2026-11-02T00:00:00.000Z'), version, 'Africa/Cairo');
  const at = (iso: string) => new Date(iso);

  it.each([
    ['07:59:59 local', '2026-11-02T05:59:59.000Z', 'NOT_OPEN'],
    ['08:00:00 local', '2026-11-02T06:00:00.000Z', PointType.GREEN],
    ['08:59:59 local', '2026-11-02T06:59:59.000Z', PointType.GREEN],
    ['09:00:00 local', '2026-11-02T07:00:00.000Z', PointType.WHITE],
    ['09:59:59 local', '2026-11-02T07:59:59.000Z', PointType.WHITE],
    ['10:00:00 local', '2026-11-02T08:00:00.000Z', PointType.RED],
    ['11:59:59 local', '2026-11-02T09:59:59.000Z', PointType.RED],
    ['12:00:00 local', '2026-11-02T10:00:00.000Z', PointType.BLACK],
  ])('%s → %s', (_label, iso, expected) => {
    expect(classifyCheckIn(at(iso), w)).toBe(expected);
  });
});

describe('overtimeGreens (TEST-013, REQ-014)', () => {
  const end = new Date('2026-11-02T14:00:00.000Z'); // 16:00 Cairo

  it.each([
    ['before shift end', '2026-11-02T13:30:00.000Z', 0],
    ['16:59 local', '2026-11-02T14:59:00.000Z', 0],
    ['17:00 local', '2026-11-02T15:00:00.000Z', 1],
    ['17:01 local', '2026-11-02T15:01:00.000Z', 1],
    ['18:01 local', '2026-11-02T16:01:00.000Z', 2],
    ['19:01 local', '2026-11-02T17:01:00.000Z', 3],
  ])('%s → %i', (_label, iso, expected) => {
    expect(overtimeGreens(new Date(iso), end)).toBe(expected);
  });
});

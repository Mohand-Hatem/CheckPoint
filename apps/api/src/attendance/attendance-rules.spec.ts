import { PointType } from '@prisma/client';
import { classifyCheckIn, computeWindows, overtimeGreens, scheduleForDay } from './attendance-rules';

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

describe('scheduleForDay (check-in and absence sweep share it)', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const employee = (isActive = true) => ({
    currentShift: {
      id: 'shift-1',
      isActive,
      versions: [
        { ...version, startTime: new Date('1970-01-01T09:00:00.000Z'), effectiveFrom: d('2026-11-10'), effectiveTo: null },
        { ...version, effectiveFrom: d('2026-11-01'), effectiveTo: d('2026-11-09') },
      ],
    },
    shiftAssignments: [
      { id: 'other', shiftId: 'shift-2', effectiveFrom: d('2026-11-01'), effectiveTo: null },
      { id: 'a-1', shiftId: 'shift-1', effectiveFrom: d('2026-11-05'), effectiveTo: null },
    ],
  });

  it('picks the shift version and the current-shift assignment in force that day', () => {
    expect(scheduleForDay(employee(), d('2026-11-09'))).toMatchObject({ shift: { startTime: version.startTime }, assignment: { id: 'a-1' } });
    expect(scheduleForDay(employee(), d('2026-11-10')).shift?.startTime).toEqual(new Date('1970-01-01T09:00:00.000Z'));
  });

  it('has no assignment before it starts and no shift when the shift is inactive or not yet in force', () => {
    expect(scheduleForDay(employee(), d('2026-11-03')).assignment).toBeUndefined();
    expect(scheduleForDay(employee(false), d('2026-11-09')).shift).toBeUndefined();
    expect(scheduleForDay(employee(), d('2026-10-31')).shift).toBeUndefined();
  });
});

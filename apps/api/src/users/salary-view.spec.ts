import { cairoToday, splitSalaryVersions } from './salary-view';

const version = (id: string, effectiveFrom: string, salary = 1000) => ({
  id,
  salary,
  effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  createdBy: null,
});

const today = new Date('2026-10-26T00:00:00.000Z');

describe('splitSalaryVersions', () => {
  it('has no current and no upcoming salary when there are no versions', () => {
    const r = splitSalaryVersions([], today);
    expect(r.current).toBeNull();
    expect(r.upcoming).toBeNull();
    expect(r.history).toEqual([]);
  });

  it('uses the latest version that has already started as current', () => {
    const r = splitSalaryVersions([version('b', '2026-10-01'), version('a', '2026-03-01')], today);
    expect(r.current?.id).toBe('b');
    expect(r.upcoming).toBeNull();
  });

  it('a version starting today is already current', () => {
    const r = splitSalaryVersions([version('a', '2026-10-26')], today);
    expect(r.current?.id).toBe('a');
  });

  it('a future raise is upcoming and never current', () => {
    const r = splitSalaryVersions([version('raise', '2026-12-01'), version('now', '2026-10-01')], today);
    expect(r.current?.id).toBe('now');
    expect(r.upcoming?.id).toBe('raise');
  });

  it('only future versions: nothing is current yet and the earliest is upcoming', () => {
    const r = splitSalaryVersions([version('later', '2027-02-01'), version('soon', '2026-11-01')], today);
    expect(r.current).toBeNull();
    expect(r.upcoming?.id).toBe('soon');
  });

  it('returns the whole history newest first with the public field names', () => {
    const r = splitSalaryVersions([version('a', '2026-03-01', 9000), version('b', '2026-10-01', 12000)], today);
    expect(r.history.map((s) => s.id)).toEqual(['b', 'a']);
    expect(r.history[0]).toEqual({
      id: 'b',
      amount: 12000,
      currency: 'EGP',
      effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      creator: null,
    });
  });
});

describe('cairoToday', () => {
  it('uses the Cairo calendar date, not UTC', () => {
    // 22:30 UTC on 25 Oct is already 26 Oct in Cairo (UTC+2 or UTC+3)
    expect(cairoToday(new Date('2026-10-25T22:30:00.000Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(cairoToday(new Date('2026-10-25T10:00:00.000Z')).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });
});

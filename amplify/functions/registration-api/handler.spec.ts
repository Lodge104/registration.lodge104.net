import { describe, expect, it } from 'vitest';
import { ageOn, duesStatus, requiredDuesYear } from './handler';

// Dates are evaluated in the lodge's time zone (America/New_York by default).
const et = (iso: string) => new Date(iso);

describe('requiredDuesYear', () => {
  it('is the current year from January through October', () => {
    expect(requiredDuesYear(et('2026-01-01T12:00:00-05:00'))).toBe(2026);
    expect(requiredDuesYear(et('2026-06-15T12:00:00-04:00'))).toBe(2026);
    expect(requiredDuesYear(et('2026-10-31T23:59:00-04:00'))).toBe(2026);
  });

  it('is the following year from November 1 through December 31', () => {
    expect(requiredDuesYear(et('2026-11-01T00:00:00-04:00'))).toBe(2027);
    expect(requiredDuesYear(et('2026-11-25T12:00:00-05:00'))).toBe(2027);
    expect(requiredDuesYear(et('2026-12-31T23:59:00-05:00'))).toBe(2027);
  });

  it('uses the lodge time zone, not UTC, at the boundaries', () => {
    // 2026-11-01 02:00 UTC is still Oct 31 in New York.
    expect(requiredDuesYear(new Date('2026-11-01T02:00:00Z'))).toBe(2026);
    // 2027-01-01 03:00 UTC is still Dec 31 in New York.
    expect(requiredDuesYear(new Date('2027-01-01T03:00:00Z'))).toBe(2027);
  });
});

describe('duesStatus', () => {
  const nov = et('2026-11-25T12:00:00-05:00'); // requires 2027
  const jun = et('2026-06-15T12:00:00-04:00'); // requires 2026

  it('is current when DuesYear equals the required year', () => {
    expect(duesStatus({ DuesYear: 2027 }, nov).current).toBe(true);
    expect(duesStatus({ DuesYear: 2026 }, jun).current).toBe(true);
  });

  it('is current when DuesYear is beyond the required year', () => {
    expect(duesStatus({ DuesYear: 2028 }, nov).current).toBe(true);
    expect(duesStatus({ DuesYear: 2027 }, jun).current).toBe(true);
  });

  it('is not current when DuesYear is behind', () => {
    expect(duesStatus({ DuesYear: 2026 }, nov)).toEqual({
      duesYear: 2026,
      requiredDuesYear: 2027,
      current: false,
    });
    expect(duesStatus({ DuesYear: 2025 }, jun).current).toBe(false);
  });
});

describe('ageOn', () => {
  it('counts whole years, before and after the birthday', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(ageOn('2013-11-25T00:00:00Z', now)).toBe(13);
    expect(ageOn('2013-11-26T00:00:00Z', now)).toBe(12);
    expect(ageOn(undefined, now)).toBeNull();
  });
});

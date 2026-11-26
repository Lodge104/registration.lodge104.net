import { describe, expect, it } from 'vitest';
import { ageOn, calendarDate, duesStatus, requiredDuesYear } from './lodge-date';

describe('calendarDate', () => {
  it('reads the date in the lodge time zone, not UTC', () => {
    // 2026-11-26 03:00 UTC is still the evening of Nov 25 in New York.
    expect(calendarDate(new Date('2026-11-26T03:00:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 25,
    });
  });
});

describe('ageOn', () => {
  it('counts whole years, before and after the birthday', () => {
    const now = new Date('2026-11-25T17:00:00Z');
    expect(ageOn('2013-11-25T00:00:00Z', now)).toBe(13);
    expect(ageOn('2013-11-26T00:00:00Z', now)).toBe(12);
    expect(ageOn('2013-11-24T00:00:00Z', now)).toBe(13);
    expect(ageOn(undefined, now)).toBeNull();
    expect(ageOn('not a date', now)).toBeNull();
  });

  it('uses the lodge calendar on the 13th birthday (the review finding)', () => {
    const birthday = '2013-11-26T00:00:00Z';
    // 02:00 UTC on Nov 26 is still Nov 25 in New York: the member is still 12.
    expect(ageOn(birthday, new Date('2026-11-26T02:00:00Z'))).toBe(12);
    // 05:00 UTC (= midnight ET, EST) is the first moment they are 13 locally.
    expect(ageOn(birthday, new Date('2026-11-26T05:00:00Z'))).toBe(13);
  });

  it('handles daylight-saving offsets', () => {
    // Summer: ET is UTC-4, so midnight ET is 04:00 UTC.
    const birthday = '2013-07-04T00:00:00Z';
    expect(ageOn(birthday, new Date('2026-07-04T03:59:00Z'))).toBe(12);
    expect(ageOn(birthday, new Date('2026-07-04T04:00:00Z'))).toBe(13);
  });

  it('accepts an explicit time zone', () => {
    const birthday = '2013-11-26T00:00:00Z';
    const now = new Date('2026-11-26T02:00:00Z');
    expect(ageOn(birthday, now, 'America/New_York')).toBe(12);
    expect(ageOn(birthday, now, 'UTC')).toBe(13);
  });
});

describe('requiredDuesYear', () => {
  it('is the current year from January through October', () => {
    expect(requiredDuesYear(new Date('2026-01-01T12:00:00-05:00'))).toBe(2026);
    expect(requiredDuesYear(new Date('2026-06-15T12:00:00-04:00'))).toBe(2026);
    expect(requiredDuesYear(new Date('2026-10-31T23:59:00-04:00'))).toBe(2026);
  });

  it('is the following year from November 1 through December 31', () => {
    expect(requiredDuesYear(new Date('2026-11-01T00:00:00-04:00'))).toBe(2027);
    expect(requiredDuesYear(new Date('2026-11-25T12:00:00-05:00'))).toBe(2027);
    expect(requiredDuesYear(new Date('2026-12-31T23:59:00-05:00'))).toBe(2027);
  });

  it('uses the lodge time zone, not UTC, at the boundaries', () => {
    expect(requiredDuesYear(new Date('2026-11-01T02:00:00Z'))).toBe(2026);
    expect(requiredDuesYear(new Date('2027-01-01T03:00:00Z'))).toBe(2027);
  });
});

describe('duesStatus', () => {
  const nov = new Date('2026-11-25T12:00:00-05:00'); // requires 2027
  const jun = new Date('2026-06-15T12:00:00-04:00'); // requires 2026

  it('is current when DuesYear equals or exceeds the required year', () => {
    expect(duesStatus({ DuesYear: 2027 }, nov).current).toBe(true);
    expect(duesStatus({ DuesYear: 2028 }, nov).current).toBe(true);
    expect(duesStatus({ DuesYear: 2026 }, jun).current).toBe(true);
    expect(duesStatus({ DuesYear: 2027 }, jun).current).toBe(true);
  });

  it('is not current when DuesYear is behind or missing', () => {
    expect(duesStatus({ DuesYear: 2026 }, nov)).toEqual({
      duesYear: 2026,
      requiredDuesYear: 2027,
      current: false,
    });
    expect(duesStatus({ DuesYear: 2025 }, jun).current).toBe(false);
    expect(duesStatus({}, jun).current).toBe(false);
  });
});

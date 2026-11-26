/**
 * Calendar logic evaluated in the lodge's time zone, so "today", a member's
 * age, and the dues cutoff all agree (instead of mixing UTC and local dates).
 */

export const DEFAULT_LODGE_TIMEZONE = 'America/New_York';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** The calendar date at `now` in `timeZone`. */
export function calendarDate(now: Date, timeZone = DEFAULT_LODGE_TIMEZONE): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * Whole years between an ISO birthdate (its calendar date, ignoring the time
 * part) and today's date in `timeZone`; null if the birthdate is unparsable.
 */
export function ageOn(
  dateOfBirth: string | undefined,
  now: Date,
  timeZone = DEFAULT_LODGE_TIMEZONE,
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = calendarDate(now, timeZone);
  let age = today.year - y;
  if (today.month < mo || (today.month === mo && today.day < d)) age -= 1;
  return age;
}

/**
 * The dues year that counts as current: next year from Nov 1 through Dec 31
 * (when the lodge starts collecting the following year's dues), otherwise
 * this year.
 */
export function requiredDuesYear(now: Date, timeZone = DEFAULT_LODGE_TIMEZONE): number {
  const { year, month } = calendarDate(now, timeZone);
  return month >= 11 ? year + 1 : year;
}

/** Dues are current when the member's latest DuesYear is at least the required year. */
export function duesStatus(
  member: { DuesYear?: number },
  now: Date,
  timeZone = DEFAULT_LODGE_TIMEZONE,
): { duesYear: number; requiredDuesYear: number; current: boolean } {
  const required = requiredDuesYear(now, timeZone);
  const duesYear = Number(member.DuesYear) || 0;
  return { duesYear, requiredDuesYear: required, current: duesYear >= required };
}

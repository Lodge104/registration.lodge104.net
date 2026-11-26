import { describe, expect, it } from 'vitest';
import {
  type EventItem,
  eligibleEvents,
  isCandidate,
  isEventEligible,
  parseEventTime,
} from './events';

const now = new Date('2026-11-26T17:00:00Z'); // Nov 26, noon ET

/** An event that passes every rule; tests override one field at a time. */
const open = (over: Partial<EventItem> = {}): EventItem => ({
  id: 1,
  name: '2027 NOAC',
  type: 'National Program',
  chapter: null,
  eventLocation: 'Out of Council',
  startDateTime: '2027-07-26T13:00:00.0000000Z',
  endDateTime: '2027-08-01T13:00:00.0000000Z',
  isModernEvent: true,
  isOnlineRegEnabled: true,
  isHiddenFromCalendar: false,
  isCalendarOnly: false,
  isOrdealInduction: false,
  onlineRegStartDate: '2026-09-02T00:00:00.0000000',
  onlineRegEndDate: '2027-05-20T00:00:00.0000000',
  ...over,
});
const member = { Chapter: 'Netami', Level: 'Ordeal' };

describe('parseEventTime', () => {
  it('reads Z timestamps as UTC', () => {
    expect(parseEventTime('2027-07-26T13:00:00.0000000Z')?.toISOString()).toBe(
      '2027-07-26T13:00:00.000Z',
    );
  });

  it('reads zone-less registration dates as lodge-local wall-clock time', () => {
    // Midnight ET in November (EST, UTC-5) and in July (EDT, UTC-4).
    expect(parseEventTime('2026-11-24T00:00:00.0000000')?.toISOString()).toBe(
      '2026-11-24T05:00:00.000Z',
    );
    expect(parseEventTime('2027-07-01T00:00:00.0000000')?.toISOString()).toBe(
      '2027-07-01T04:00:00.000Z',
    );
  });

  it('returns null for missing or malformed values', () => {
    for (const bad of [null, undefined, '', '2026-11-24', 'soon']) {
      expect(parseEventTime(bad)).toBeNull();
    }
  });
});

describe('isEventEligible', () => {
  it('accepts an open, modern, upcoming event', () => {
    expect(isEventEligible(open(), member, now)).toBe(true);
  });

  it('requires a modern event with online registration enabled', () => {
    expect(isEventEligible(open({ isModernEvent: false }), member, now)).toBe(false);
    expect(isEventEligible(open({ isOnlineRegEnabled: false }), member, now)).toBe(false);
  });

  it('excludes hidden and calendar-only events', () => {
    expect(isEventEligible(open({ isHiddenFromCalendar: true }), member, now)).toBe(false);
    expect(isEventEligible(open({ isCalendarOnly: true }), member, now)).toBe(false);
  });

  it('excludes past events but keeps one that is still in progress', () => {
    const past = open({
      startDateTime: '2026-11-01T13:00:00Z',
      endDateTime: '2026-11-02T13:00:00Z',
    });
    expect(isEventEligible(past, member, now)).toBe(false);
    const inProgress = open({
      startDateTime: '2026-11-25T13:00:00Z',
      endDateTime: '2026-11-27T13:00:00Z',
    });
    expect(isEventEligible(inProgress, member, now)).toBe(true);
  });

  it('requires today to be inside the registration window', () => {
    expect(
      isEventEligible(open({ onlineRegStartDate: '2026-12-01T00:00:00.0000000' }), member, now),
    ).toBe(false);
    expect(
      isEventEligible(open({ onlineRegEndDate: '2026-11-25T00:00:00.0000000' }), member, now),
    ).toBe(false);
  });

  it('treats a missing registration window as not open', () => {
    expect(isEventEligible(open({ onlineRegStartDate: null }), member, now)).toBe(false);
    expect(isEventEligible(open({ onlineRegEndDate: null }), member, now)).toBe(false);
  });

  it('evaluates the window boundaries in the lodge time zone', () => {
    // Registration opens at midnight ET on Nov 27 = 05:00 UTC.
    const opensTomorrow = open({ onlineRegStartDate: '2026-11-27T00:00:00.0000000' });
    expect(isEventEligible(opensTomorrow, member, new Date('2026-11-27T04:59:00Z'))).toBe(false);
    expect(isEventEligible(opensTomorrow, member, new Date('2026-11-27T05:00:00Z'))).toBe(true);
  });

  it("only shows chapter events for the member's own chapter", () => {
    const chapterEvent = open({ type: 'Chapter', chapter: 'Netami' });
    expect(isEventEligible(chapterEvent, member, now)).toBe(true);
    expect(isEventEligible(chapterEvent, { ...member, Chapter: ' netami ' }, now)).toBe(true);
    expect(isEventEligible(chapterEvent, { ...member, Chapter: 'Neusiok' }, now)).toBe(false);
    expect(isEventEligible(chapterEvent, { ...member, Chapter: null }, now)).toBe(false);
    expect(isEventEligible(open({ type: 'Chapter', chapter: null }), member, now)).toBe(false);
  });

  it('does not apply the chapter rule to lodge-wide events', () => {
    expect(isEventEligible(open({ chapter: 'Neusiok' }), member, now)).toBe(true);
  });

  it('shows candidates only Ordeal inductions', () => {
    const candidate = { ...member, Level: 'Candidate' };
    expect(isEventEligible(open(), candidate, now)).toBe(false);
    expect(isEventEligible(open({ isOrdealInduction: true }), candidate, now)).toBe(true);
    // Non-candidates still see Ordeal inductions.
    expect(isEventEligible(open({ isOrdealInduction: true }), member, now)).toBe(true);
  });

  it('rejects malformed items', () => {
    expect(isEventEligible(open({ id: undefined }), member, now)).toBe(false);
    expect(isEventEligible(open({ name: '  ' }), member, now)).toBe(false);
    expect(isEventEligible(open({ startDateTime: 'soon' }), member, now)).toBe(false);
  });
});

describe('isCandidate', () => {
  it('matches the Candidate level case-insensitively', () => {
    expect(isCandidate({ Level: 'Candidate' })).toBe(true);
    expect(isCandidate({ Level: ' candidate ' })).toBe(true);
    expect(isCandidate({ Level: 'Ordeal' })).toBe(false);
    expect(isCandidate({})).toBe(false);
  });
});

describe('eligibleEvents', () => {
  it('filters, trims to display fields, and sorts soonest first', () => {
    const result = eligibleEvents(
      [
        open({ id: 3, name: 'Later', startDateTime: '2027-07-26T13:00:00Z' }),
        open({ id: 2, name: 'Hidden', isHiddenFromCalendar: true }),
        open({ id: 1, name: ' Sooner ', startDateTime: '2027-01-10T13:00:00Z', eventLocation: '' }),
      ],
      member,
      now,
    );
    expect(result).toEqual([
      {
        id: '1',
        name: 'Sooner',
        location: null,
        startDateTime: '2027-01-10T13:00:00Z',
        endDateTime: '2027-08-01T13:00:00.0000000Z',
      },
      {
        id: '3',
        name: 'Later',
        location: 'Out of Council',
        startDateTime: '2027-07-26T13:00:00Z',
        endDateTime: '2027-08-01T13:00:00.0000000Z',
      },
    ]);
  });
});

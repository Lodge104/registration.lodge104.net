/**
 * Which LodgeMaster events an under-13 member with current dues may register
 * for online. Pure functions over lodge104-event_data items (no I/O), so the
 * rules are easy to test and read.
 */

/** The subset of a lodge104-event_data item these rules use. */
export interface EventItem {
  id?: number;
  name?: string | null;
  type?: string | null;
  chapter?: string | null;
  eventLocation?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  isModernEvent?: boolean;
  isOnlineRegEnabled?: boolean;
  isHiddenFromCalendar?: boolean;
  isCalendarOnly?: boolean;
  isOrdealInduction?: boolean;
  onlineRegStartDate?: string | null;
  onlineRegEndDate?: string | null;
}

/** What the member's record contributes to eligibility. */
export interface EventMember {
  Chapter?: string | null;
  Level?: string | null;
}

/** What the page shows for one event. `id` is a string to match the GraphQL schema. */
export interface EligibleEvent {
  id: string;
  name: string;
  location: string | null;
  startDateTime: string;
  endDateTime: string | null;
  /** The member already has a registration (lodge104-event_attendees) for this event. */
  alreadyRegistered: boolean;
}

/**
 * Parses a LodgeMaster timestamp. Event start/end carry a `Z` (UTC); the
 * online-registration dates do not, e.g. "2026-11-24T00:00:00.0000000".
 * Those are lodge-local dates, so they are read as wall-clock times in
 * `timeZone` rather than as UTC.
 */
export function parseEventTime(
  value: string | null | undefined,
  timeZone = 'America/New_York',
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(
    value ?? '',
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  if (zone) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone === 'Z' ? 'Z' : zone}`);

  // Wall-clock time in `timeZone`: start from the same digits as UTC, then
  // subtract that zone's offset at that moment (twice, to settle across a DST
  // change).
  const wallAsUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) guess = wallAsUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Offset of `timeZone` from UTC at `at`, in milliseconds (e.g. -5h for EST). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  return norm(a) !== '' && norm(a) === norm(b);
}

/** "Candidate" is a member who has not yet completed their Ordeal. */
export function isCandidate(member: EventMember): boolean {
  return same(member.Level, 'Candidate');
}

/**
 * Whether `event` can be offered for online registration to `member` at `now`:
 *   - a modern LodgeMaster event with online registration enabled,
 *   - not past (it hasn't ended), and not hidden or calendar-only,
 *   - `now` is inside the online registration window (both dates required),
 *   - chapter events only for members of that chapter,
 *   - candidates only see Ordeal inductions.
 */
export function isEventEligible(
  event: EventItem,
  member: EventMember,
  now: Date,
  timeZone = 'America/New_York',
): boolean {
  if (typeof event.id !== 'number' || !event.name?.trim()) return false;
  if (event.isModernEvent !== true || event.isOnlineRegEnabled !== true) return false;
  if (event.isHiddenFromCalendar === true || event.isCalendarOnly === true) return false;

  const start = parseEventTime(event.startDateTime, timeZone);
  const end = parseEventTime(event.endDateTime, timeZone) ?? start;
  if (!start || !end || end.getTime() < now.getTime()) return false;

  const regOpens = parseEventTime(event.onlineRegStartDate, timeZone);
  const regCloses = parseEventTime(event.onlineRegEndDate, timeZone);
  if (!regOpens || !regCloses) return false;
  if (now.getTime() < regOpens.getTime() || now.getTime() > regCloses.getTime()) return false;

  if (same(event.type, 'Chapter') && !same(event.chapter, member.Chapter)) return false;
  if (isCandidate(member) && event.isOrdealInduction !== true) return false;

  return true;
}

/** Eligible events, soonest first, trimmed to what the page displays. */
export function eligibleEvents(
  events: Iterable<EventItem>,
  member: EventMember,
  now: Date,
  timeZone = 'America/New_York',
  registeredEventIds: ReadonlySet<number> = new Set(),
): EligibleEvent[] {
  return [...events]
    .filter((e) => isEventEligible(e, member, now, timeZone))
    .map((e) => ({
      id: String(e.id),
      name: (e.name as string).trim(),
      location: e.eventLocation?.trim() || null,
      startDateTime: e.startDateTime as string,
      endDateTime: e.endDateTime ?? null,
      alreadyRegistered: registeredEventIds.has(e.id as number),
    }))
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
}

/**
 * A candidate may hold only one Ordeal registration at a time. Returns the
 * Ordeal induction they're registered for that hasn't ended yet (soonest
 * first), or null. Once it ends, they're free to register for another.
 *
 * Looks at every registered event, not just ones still open for online
 * registration, so a registration whose window has since closed still counts.
 */
export function activeOrdealRegistration(
  events: Iterable<EventItem>,
  registeredEventIds: ReadonlySet<number>,
  now: Date,
  timeZone = 'America/New_York',
): EventItem | null {
  const active = [...events].filter((e) => {
    if (typeof e.id !== 'number' || !registeredEventIds.has(e.id)) return false;
    if (e.isOrdealInduction !== true) return false;
    const start = parseEventTime(e.startDateTime, timeZone);
    const end = parseEventTime(e.endDateTime, timeZone) ?? start;
    return !!end && end.getTime() >= now.getTime();
  });
  active.sort((a, b) => (a.startDateTime ?? '').localeCompare(b.startDateTime ?? ''));
  return active[0] ?? null;
}

/**
 * What the member can do with one eligible event:
 *   - 'registered': already registered for it,
 *   - 'blocked':    a candidate already holding a different, unfinished Ordeal,
 *   - 'open':       may register.
 */
export function registrationState(
  eventId: number,
  member: EventMember,
  registeredEventIds: ReadonlySet<number>,
  activeOrdeal: EventItem | null,
): 'registered' | 'blocked' | 'open' {
  if (registeredEventIds.has(eventId)) return 'registered';
  if (isCandidate(member) && activeOrdeal && activeOrdeal.id !== eventId) return 'blocked';
  return 'open';
}

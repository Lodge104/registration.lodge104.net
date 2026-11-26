/**
 * In-memory index for name + birthdate lookups.
 *
 * lodge104-member_data is keyed on BsaPersonId only (and is owned by another
 * stack), so there is no index to query by name. Rather than scan the table on
 * every public request, each Lambda container builds a small
 * `name|birthdate -> BsaPersonId` map once and reuses it for a few minutes.
 * The map only locates *who* matched; the member's live record is always
 * re-read by ID, so portal status and dues are never stale.
 */

export interface RosterItem {
  BsaPersonId?: number;
  FirstName?: string | null;
  LastName?: string | null;
  DateOfBirth?: string | null;
}

export type RosterIndex = ReadonlyMap<string, ReadonlySet<number>>;

/** Case/whitespace-insensitive (about 1% of stored names have stray spaces or are all-caps). */
function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** `birthDate` is YYYY-MM-DD. */
export function rosterKey(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  birthDate: string,
): string {
  return `${normalizeName(firstName)}|${normalizeName(lastName)}|${birthDate}`;
}

export function buildRosterIndex(items: Iterable<RosterItem>): RosterIndex {
  const index = new Map<string, Set<number>>();
  for (const item of items) {
    const birthDate = /^(\d{4}-\d{2}-\d{2})/.exec(item.DateOfBirth ?? '')?.[1];
    if (!birthDate || typeof item.BsaPersonId !== 'number') continue;
    const key = rosterKey(item.FirstName, item.LastName, birthDate);
    const ids = index.get(key) ?? new Set<number>();
    ids.add(item.BsaPersonId);
    index.set(key, ids);
  }
  return index;
}

/**
 * Caches the result of `load` for `ttlMs`. Concurrent callers share one load,
 * and a failed load is not cached (the next call retries).
 */
export function createRosterCache(
  load: () => Promise<RosterIndex>,
  ttlMs: number,
): (now?: number) => Promise<RosterIndex> {
  let current: { at: number; index: RosterIndex } | undefined;
  let inflight: Promise<RosterIndex> | undefined;

  return async (now = Date.now()) => {
    if (current && now - current.at < ttlMs) return current.index;
    inflight ??= load()
      .then((index) => {
        current = { at: now, index };
        return index;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
}

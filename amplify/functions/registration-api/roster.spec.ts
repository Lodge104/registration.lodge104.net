import { describe, expect, it, vi } from 'vitest';
import { buildRosterIndex, createRosterCache, rosterKey } from './roster';

const member = (id: number, first: string, last: string, dob = '2013-03-09T00:00:00Z') => ({
  BsaPersonId: id,
  FirstName: first,
  LastName: last,
  DateOfBirth: dob,
});

describe('buildRosterIndex', () => {
  it('finds a member by name and birthdate, ignoring case and stray whitespace', () => {
    const index = buildRosterIndex([member(1, ' PAT  ', 'Scout ')]);
    expect(index.get(rosterKey('pat', 'scout', '2013-03-09'))).toEqual(new Set([1]));
    expect(index.get(rosterKey('Pat', 'SCOUT', '2013-03-09'))).toEqual(new Set([1]));
  });

  it('does not match a different birthdate or name', () => {
    const index = buildRosterIndex([member(1, 'Pat', 'Scout')]);
    expect(index.get(rosterKey('Pat', 'Scout', '2013-03-10'))).toBeUndefined();
    expect(index.get(rosterKey('Pat', 'Other', '2013-03-09'))).toBeUndefined();
  });

  it('collapses a person with several dues-year rows into one id', () => {
    const index = buildRosterIndex([member(1, 'Pat', 'Scout'), member(1, 'Pat', 'Scout')]);
    expect(index.get(rosterKey('Pat', 'Scout', '2013-03-09'))?.size).toBe(1);
  });

  it('keeps two different people with the same name and birthdate distinct (ambiguous)', () => {
    const index = buildRosterIndex([member(1, 'Pat', 'Scout'), member(2, 'Pat', 'Scout')]);
    expect(index.get(rosterKey('Pat', 'Scout', '2013-03-09'))).toEqual(new Set([1, 2]));
  });

  it('skips rows without a usable id or birthdate', () => {
    const index = buildRosterIndex([
      { FirstName: 'A', LastName: 'B', DateOfBirth: '2013-03-09T00:00:00Z' },
      member(3, 'C', 'D', 'garbage'),
      member(4, 'E', 'F', ''),
    ]);
    expect(index.size).toBe(0);
  });
});

describe('createRosterCache', () => {
  const index = buildRosterIndex([member(1, 'Pat', 'Scout')]);

  it('loads once and reuses the result within the TTL', async () => {
    const load = vi.fn().mockResolvedValue(index);
    const get = createRosterCache(load, 1000);
    expect(await get(0)).toBe(index);
    expect(await get(999)).toBe(index);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL', async () => {
    const load = vi.fn().mockResolvedValue(index);
    const get = createRosterCache(load, 1000);
    await get(0);
    await get(1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers', async () => {
    const load = vi.fn().mockResolvedValue(index);
    const get = createRosterCache(load, 1000);
    await Promise.all([get(0), get(0), get(0)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load, so the next call retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('throttled')).mockResolvedValue(index);
    const get = createRosterCache(load, 1000);
    await expect(get(0)).rejects.toThrow('throttled');
    expect(await get(1)).toBe(index);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

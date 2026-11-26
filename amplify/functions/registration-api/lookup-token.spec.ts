import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOOKUP_TOKEN_TTL_MS, signLookupToken, verifyLookupToken } from './lookup-token';

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);
const now = new Date('2026-11-25T12:00:00Z');

describe('lookup tokens', () => {
  it('round-trips a member id', () => {
    expect(verifyLookupToken(signLookupToken(1234567, now, key), now, key)).toBe(1234567);
  });

  it('rejects a token signed with a different key', () => {
    expect(verifyLookupToken(signLookupToken(1234567, now, otherKey), now, key)).toBeNull();
  });

  it('rejects an unsigned, forged token (the old base64-JSON format)', () => {
    const forged = Buffer.from(JSON.stringify({ b: 999, t: now.getTime() })).toString('base64url');
    expect(verifyLookupToken(forged, now, key)).toBeNull();
    expect(verifyLookupToken(`${forged}.`, now, key)).toBeNull();
    expect(verifyLookupToken(`${forged}.AAAA`, now, key)).toBeNull();
  });

  it('rejects a token whose payload was edited after signing', () => {
    const [, signature] = signLookupToken(1234567, now, key).split('.');
    const tampered = Buffer.from(JSON.stringify({ b: 7654321, t: now.getTime() })).toString(
      'base64url',
    );
    expect(verifyLookupToken(`${tampered}.${signature}`, now, key)).toBeNull();
  });

  it('rejects a validly signed token with a non-integer or non-positive id', () => {
    const sign = (payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
    };
    const t = now.getTime();
    expect(verifyLookupToken(sign({ b: 1.5, t }), now, key)).toBeNull();
    expect(verifyLookupToken(sign({ b: -1, t }), now, key)).toBeNull();
    expect(verifyLookupToken(sign({ b: '123', t }), now, key)).toBeNull();
    expect(verifyLookupToken(sign({ b: 123 }), now, key)).toBeNull();
  });

  it('expires after the TTL and rejects tokens from the future', () => {
    const token = signLookupToken(1234567, now, key);
    const justInside = new Date(now.getTime() + LOOKUP_TOKEN_TTL_MS);
    const justOutside = new Date(now.getTime() + LOOKUP_TOKEN_TTL_MS + 1);
    expect(verifyLookupToken(token, justInside, key)).toBe(1234567);
    expect(verifyLookupToken(token, justOutside, key)).toBeNull();

    const future = signLookupToken(1234567, new Date(now.getTime() + 10 * 60_000), key);
    expect(verifyLookupToken(future, now, key)).toBeNull();
  });

  it('treats missing or garbage input as invalid, not as an error', () => {
    for (const bad of [undefined, null, '', '.', 'a.b.c', 'not a token', '\u0000.\u0000']) {
      expect(verifyLookupToken(bad, now, key)).toBeNull();
    }
  });

  it('refuses a short signing key rather than silently weakening the check', () => {
    expect(() => signLookupToken(1, now, Buffer.from('short'))).toThrow(/at least 32 bytes/);
    expect(() => verifyLookupToken('x.y', now, Buffer.from('short'))).toThrow(/at least 32 bytes/);
  });
});

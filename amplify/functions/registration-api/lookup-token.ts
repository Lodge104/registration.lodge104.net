import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Lookup tokens tie a follow-up call (sendPortalInvite / requestDuesLink) to a
 * recent, successful lookup. They are HMAC-SHA256 signed with a server-side
 * secret, so a caller cannot mint one for an arbitrary member ID: the payload
 * is readable but any change invalidates the signature.
 *
 * Format: `<base64url(JSON {b: bsaPersonId, t: issuedAtMs})>.<base64url(HMAC)>`
 */

export const LOOKUP_TOKEN_TTL_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const MIN_KEY_BYTES = 32;

function assertKey(key: Buffer): void {
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(`Lookup token key must be at least ${MIN_KEY_BYTES} bytes`);
  }
}

function mac(data: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export function signLookupToken(bsaPersonId: number, now: Date, key: Buffer): string {
  assertKey(key);
  const payload = Buffer.from(JSON.stringify({ b: bsaPersonId, t: now.getTime() })).toString(
    'base64url',
  );
  return `${payload}.${mac(payload, key).toString('base64url')}`;
}

/** Returns the member ID if the token is authentic and unexpired, otherwise null. */
export function verifyLookupToken(
  token: string | null | undefined,
  now: Date,
  key: Buffer,
): number | null {
  assertKey(key); // a bad key is a configuration error, not an "invalid token"
  try {
    const parts = (token ?? '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, signature] = parts;

    const expected = mac(payload, key);
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const { b, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      b: unknown;
      t: unknown;
    };
    if (typeof b !== 'number' || !Number.isInteger(b) || b <= 0 || typeof t !== 'number') {
      return null;
    }
    if (now.getTime() - t > LOOKUP_TOKEN_TTL_MS || t > now.getTime() + CLOCK_SKEW_MS) return null;
    return b;
  } catch {
    return null;
  }
}

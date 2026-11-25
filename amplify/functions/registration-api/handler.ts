import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { AppSyncResolverHandler } from 'aws-lambda';

/*
 * Single Lambda behind two AppSync operations:
 *
 *   lookupMember(bsaId | firstName+lastName+birthDate)
 *     -> finds the member in lodge104-member_data and reports which portal
 *        action applies (PortalAction). Returns NOT_FOUND / AMBIGUOUS rather
 *        than throwing so the UI can show the right message.
 *
 *   sendPortalInvite(lookupToken, email)
 *     -> re-resolves the member server-side from the opaque lookupToken
 *        (never trusts a client-supplied OalmId), then calls the LodgeMaster
 *        "account/add" (No Account) or "account/resendinvite" (Invitation
 *        Sent) endpoint with the session cookies from lodge104-keys.
 *
 * Security notes:
 *   - The API is public (API key), so responses expose only the minimum the
 *     UI needs: first name, a portal action, and the primary email (to
 *     pre-fill the confirmation popup, per requirements).
 *   - Cookie values are never logged.
 */

const {
  MEMBER_DATA_TABLE_NAME = 'lodge104-member_data',
  KEYS_TABLE_NAME = 'lodge104-keys',
  LODGEMASTER_BASE_URL = 'https://lodgemaster-client.oa-scouting.org',
  MIN_PORTAL_AGE = '13',
} = process.env;

const XSRF_TOKEN_COOKIE = 'XSRF-TOKEN';
const LOOKUP_TOKEN_TTL_MS = 30 * 60 * 1000;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Exact values stored in lodge104-member_data.PortalAccount. */
const PORTAL_ACCOUNT = {
  active: 'Account Claimed And Active',
  none: 'No Account',
  invited: 'Invitation Sent',
} as const;

export type LookupStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
export type PortalAction =
  | 'ACCOUNT_ACTIVE'
  | 'CREATE_ACCOUNT'
  | 'RESEND_INVITE'
  | 'UNDER_AGE'
  | 'UNKNOWN';

export interface LookupResult {
  status: LookupStatus;
  action: PortalAction | null;
  firstName: string | null;
  email: string | null;
  lookupToken: string | null;
}

export interface InviteResult {
  success: boolean;
  message: string;
  email: string | null;
  expiresAt: string | null;
}

interface MemberRecord {
  BsaPersonId: number;
  DuesYear: number;
  OalmId?: number;
  FirstName?: string;
  LastName?: string;
  DateOfBirth?: string;
  PortalAccount?: string;
  EmailPrimaryAddress?: string | null;
}

interface LookupArgs {
  bsaId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  birthDate?: string | null;
}

interface InviteArgs {
  lookupToken: string;
  email: string;
}

type FieldName = 'lookupMember' | 'sendPortalInvite';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: AppSyncResolverHandler<
  LookupArgs | InviteArgs,
  LookupResult | InviteResult
> = async (event) => {
  const field = event.info.fieldName as FieldName;
  switch (field) {
    case 'lookupMember':
      return lookupMember(event.arguments as LookupArgs);
    case 'sendPortalInvite':
      return sendPortalInvite(event.arguments as InviteArgs);
    default:
      throw new Error(`Unsupported field: ${String(field)}`);
  }
};

// ---------------------------------------------------------------------------
// lookupMember
// ---------------------------------------------------------------------------

export async function lookupMember(args: LookupArgs, now = new Date()): Promise<LookupResult> {
  const matches = await findMembers(args);
  const people = groupByPerson(matches);

  if (people.size === 0) return notFound('NOT_FOUND');
  if (people.size > 1) return notFound('AMBIGUOUS');

  const [bsaPersonId, records] = [...people.entries()][0];
  const member = latestRecord(records);

  return {
    status: 'FOUND',
    action: portalAction(member, now),
    firstName: clean(member.FirstName) || null,
    email: clean(member.EmailPrimaryAddress) || null,
    lookupToken: encodeLookupToken(bsaPersonId, now),
  };
}

async function findMembers(args: LookupArgs): Promise<MemberRecord[]> {
  const bsaId = clean(args.bsaId);
  if (bsaId) {
    if (!/^\d{1,12}$/.test(bsaId)) return [];
    return queryByBsaId(Number(bsaId));
  }

  const firstName = normalizeName(args.firstName);
  const lastName = normalizeName(args.lastName);
  const birthDate = clean(args.birthDate);
  if (!firstName || !lastName || !birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return [];
  }
  return scanByNameAndBirthDate(firstName, lastName, birthDate);
}

async function queryByBsaId(bsaPersonId: number): Promise<MemberRecord[]> {
  const items: MemberRecord[] = [];
  let ExclusiveStartKey: QueryCommandOutput['LastEvaluatedKey'];
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: MEMBER_DATA_TABLE_NAME,
        KeyConditionExpression: 'BsaPersonId = :id',
        ExpressionAttributeValues: { ':id': bsaPersonId },
        ExclusiveStartKey,
      }),
    );
    items.push(...((page.Items ?? []) as MemberRecord[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * The table is keyed on BsaPersonId only, so a name + birthdate lookup is a
 * filtered scan (~10k items / ~14 MB today, a few pages). The birthdate is the
 * server-side filter (DateOfBirth is stored as "YYYY-MM-DDT00:00:00Z"); names
 * are then compared case/whitespace-insensitively in code, since ~1% of
 * stored names have stray whitespace or are all-caps.
 */
async function scanByNameAndBirthDate(
  firstName: string,
  lastName: string,
  birthDate: string,
): Promise<MemberRecord[]> {
  const items: MemberRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: MEMBER_DATA_TABLE_NAME,
        FilterExpression: 'DateOfBirth = :dob',
        ExpressionAttributeValues: { ':dob': `${birthDate}T00:00:00Z` },
        ProjectionExpression:
          'BsaPersonId, DuesYear, OalmId, FirstName, LastName, DateOfBirth, PortalAccount, EmailPrimaryAddress',
        ExclusiveStartKey,
      }),
    );
    for (const item of (page.Items ?? []) as MemberRecord[]) {
      if (normalizeName(item.FirstName) === firstName && normalizeName(item.LastName) === lastName) {
        items.push(item);
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** A member has one item per dues year; collapse to one entry per person. */
function groupByPerson(records: MemberRecord[]): Map<number, MemberRecord[]> {
  const people = new Map<number, MemberRecord[]>();
  for (const r of records) {
    const list = people.get(r.BsaPersonId) ?? [];
    list.push(r);
    people.set(r.BsaPersonId, list);
  }
  return people;
}

/**
 * PortalAccount can differ between a person's dues-year items (the sync only
 * refreshes recent years), so use the item with the newest DuesYear.
 */
function latestRecord(records: MemberRecord[]): MemberRecord {
  return records.reduce((a, b) => (b.DuesYear > a.DuesYear ? b : a));
}

export function portalAction(member: MemberRecord, now: Date): PortalAction {
  const age = ageOn(member.DateOfBirth, now);
  if (age === null || age < Number(MIN_PORTAL_AGE)) return 'UNDER_AGE';

  switch (clean(member.PortalAccount)) {
    case PORTAL_ACCOUNT.active:
      return 'ACCOUNT_ACTIVE';
    case PORTAL_ACCOUNT.none:
      return 'CREATE_ACCOUNT';
    case PORTAL_ACCOUNT.invited:
      return 'RESEND_INVITE';
    default:
      return 'UNKNOWN';
  }
}

/** Whole years between an ISO birthdate and `now` (UTC), or null if unparsable. */
export function ageOn(dateOfBirth: string | undefined, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

function notFound(status: Exclude<LookupStatus, 'FOUND'>): LookupResult {
  return { status, action: null, firstName: null, email: null, lookupToken: null };
}

// ---------------------------------------------------------------------------
// sendPortalInvite
// ---------------------------------------------------------------------------

export async function sendPortalInvite(args: InviteArgs, now = new Date()): Promise<InviteResult> {
  const email = clean(args.email).toLowerCase();
  if (!isValidEmail(email)) {
    return failure('Please enter a valid email address.');
  }

  const bsaPersonId = decodeLookupToken(args.lookupToken, now);
  if (bsaPersonId === null) {
    return failure('Your session has expired. Please look yourself up again.');
  }

  const records = await queryByBsaId(bsaPersonId);
  if (records.length === 0) {
    return failure('We could not find your member record. Please look yourself up again.');
  }
  const member = latestRecord(records);
  const action = portalAction(member, now);

  let endpoint: 'add' | 'resendinvite';
  if (action === 'CREATE_ACCOUNT') endpoint = 'add';
  else if (action === 'RESEND_INVITE') endpoint = 'resendinvite';
  else return failure('A portal invitation cannot be sent for this member.');

  if (!member.OalmId) {
    return failure('Your member record is missing a LodgeMaster ID.');
  }

  const response = await callLodgeMaster(
    `/api/members/${encodeURIComponent(String(member.OalmId))}/account/${endpoint}`,
    { email },
  );

  return {
    success: true,
    message: response.statusText ?? 'Invitation Sent',
    email: response.regEmail ?? email,
    expiresAt: response.regCodeExpirationTime ?? null,
  };
}

function failure(message: string): InviteResult {
  return { success: false, message, email: null, expiresAt: null };
}

// ---------------------------------------------------------------------------
// LodgeMaster client
// ---------------------------------------------------------------------------

interface LodgeMasterInviteResponse {
  statusCode?: number;
  statusText?: string;
  regEmail?: string;
  regCodeExpirationTime?: string;
}

/** Every cookie in lodge104-keys, read fresh (the scraper rotates them). */
async function loadSessionCookies(): Promise<Record<string, string>> {
  const cookies: Record<string, string> = {};
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: KEYS_TABLE_NAME, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      if (typeof item['name'] === 'string' && typeof item['value'] === 'string') {
        cookies[item['name']] = item['value'];
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (!cookies[XSRF_TOKEN_COOKIE]) {
    throw new Error(`${KEYS_TABLE_NAME} has no ${XSRF_TOKEN_COOKIE} cookie`);
  }
  return cookies;
}

function lodgeMasterHeaders(cookies: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: LODGEMASTER_BASE_URL,
    Referer: `${LODGEMASTER_BASE_URL}/`,
    Cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
    'X-XSRF-TOKEN': cookies[XSRF_TOKEN_COOKIE],
  };
}

function mergeSetCookies(cookies: Record<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';', 1);
    const idx = pair.indexOf('=');
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

async function callLodgeMaster(path: string, body: unknown): Promise<LodgeMasterInviteResponse> {
  const cookies = await loadSessionCookies();

  // The stored cookies alone are rejected until the SPA's startup call has
  // been made; it also returns refreshed XSRF/auth cookies to use instead
  // (same flow as members.lodgemaster.lambda.lodge104.net).
  const login = await fetch(`${LODGEMASTER_BASE_URL}/api/app/login`, {
    method: 'POST',
    headers: lodgeMasterHeaders(cookies),
    body: '',
    redirect: 'manual',
  });
  if (login.status !== 200) {
    console.error('LodgeMaster /api/app/login failed', { status: login.status });
    throw new Error('Unable to reach LodgeMaster right now. Please try again later.');
  }
  mergeSetCookies(cookies, login);

  const response = await fetch(`${LODGEMASTER_BASE_URL}${path}`, {
    method: 'POST',
    headers: lodgeMasterHeaders(cookies),
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  if (response.status !== 200) {
    console.error('LodgeMaster request failed', { path, status: response.status });
    throw new Error('LodgeMaster could not send the invitation. Please try again later.');
  }
  try {
    return text ? (JSON.parse(text) as LodgeMasterInviteResponse) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Lookup token
//
// A short-lived, opaque reference to the matched member so the client never
// has to send (or learn) an internal ID. It is NOT a security boundary — the
// BSA ID is already something the user typed — it only binds the follow-up
// call to a recent lookup and lets the server re-check eligibility.
// ---------------------------------------------------------------------------

export function encodeLookupToken(bsaPersonId: number, now: Date): string {
  return Buffer.from(JSON.stringify({ b: bsaPersonId, t: now.getTime() })).toString('base64url');
}

export function decodeLookupToken(token: string | undefined, now: Date): number | null {
  try {
    const { b, t } = JSON.parse(Buffer.from(token ?? '', 'base64url').toString('utf8')) as {
      b: unknown;
      t: unknown;
    };
    if (typeof b !== 'number' || !Number.isInteger(b) || typeof t !== 'number') return null;
    if (now.getTime() - t > LOOKUP_TOKEN_TTL_MS || t > now.getTime() + 60_000) return null;
    return b;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeName(value: string | null | undefined): string {
  return clean(value).replace(/\s+/g, ' ').toLowerCase();
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DEFAULT_LODGE_TIMEZONE, ageOn, duesStatus } from './lodge-date';
import { signLookupToken, verifyLookupToken } from './lookup-token';
import { buildRosterIndex, createRosterCache, rosterKey, type RosterItem } from './roster';

/*
 * Single Lambda behind three AppSync operations:
 *
 *   lookupMember(bsaId | firstName+lastName+birthDate)
 *     -> finds the member in lodge104-member_data and reports which portal
 *        action applies (PortalAction). Returns NOT_FOUND / AMBIGUOUS rather
 *        than throwing so the UI can show the right message.
 *
 *   sendPortalInvite(lookupToken, email)
 *     -> verifies the signed lookupToken, re-resolves the member server-side
 *        (never trusts a client-supplied OalmId), then calls the LodgeMaster
 *        "account/add" (No Account) or "account/resendinvite" (Invitation
 *        Sent) endpoint with the session cookies from lodge104-keys.
 *
 *   requestDuesLink(lookupToken)
 *     -> same token check, for under-13 members whose dues are behind.
 *
 * Security notes:
 *   - The API is public (API key); abuse is limited by a WAF rate limit and a
 *     Lambda concurrency cap (see amplify/backend.ts), not by this code.
 *   - Follow-up calls need an HMAC-signed lookupToken (see lookup-token.ts), so
 *     a caller cannot forge one for an arbitrary member.
 *   - Operations with external side effects (LodgeMaster invites / dues links)
 *     only run when SIDE_EFFECTS_ENABLED=true, which backend.ts sets for real
 *     branch deployments only, never for personal sandboxes.
 *   - Responses expose only what the UI needs: first name, a portal action, and
 *     the primary email (to pre-fill the confirmation popup, per requirements).
 *   - Cookie values are never logged.
 */

const {
  MEMBER_DATA_TABLE_NAME = 'lodge104-member_data',
  KEYS_TABLE_NAME = 'lodge104-keys',
  LODGEMASTER_BASE_URL = 'https://lodgemaster-client.oa-scouting.org',
  MIN_PORTAL_AGE = '13',
  DUES_TIMEZONE = DEFAULT_LODGE_TIMEZONE,
  DUES_LINK_ORIGIN = 'https://members.oa-scouting.org',
  LOOKUP_TOKEN_SECRET_ARN,
  SIDE_EFFECTS_ENABLED,
  ROSTER_CACHE_TTL_SECONDS = '300',
} = process.env;

const XSRF_TOKEN_COOKIE = 'XSRF-TOKEN';

/** Default-deny: only an explicit "true" (set by backend.ts) enables side effects. */
const sideEffectsEnabled = SIDE_EFFECTS_ENABLED === 'true';
const SIDE_EFFECTS_DISABLED_MESSAGE =
  'This environment is read-only, so emails and payment links are disabled here.';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secrets = new SecretsManagerClient({});

// ---------------------------------------------------------------------------
// Lookup-token signing key (Secrets Manager, created per deployment by backend.ts)
// ---------------------------------------------------------------------------

let tokenKey: Promise<Buffer> | undefined;

function getTokenKey(): Promise<Buffer> {
  tokenKey ??= loadTokenKey().catch((err: unknown) => {
    tokenKey = undefined; // don't cache a failure
    throw err;
  });
  return tokenKey;
}

async function loadTokenKey(): Promise<Buffer> {
  if (!LOOKUP_TOKEN_SECRET_ARN) throw new Error('LOOKUP_TOKEN_SECRET_ARN is not configured');
  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: LOOKUP_TOKEN_SECRET_ARN }),
  );
  if (!SecretString) throw new Error('The lookup token secret has no value');
  return Buffer.from(SecretString, 'utf8');
}

/** Tests only: supply (or clear) the signing key instead of reading Secrets Manager. */
export function setLookupTokenKeyForTesting(key: Buffer | undefined): void {
  tokenKey = key ? Promise.resolve(key) : undefined;
}

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
  'ACCOUNT_ACTIVE' | 'CREATE_ACCOUNT' | 'RESEND_INVITE' | 'UNDER_AGE' | 'UNKNOWN';

export interface LookupResult {
  status: LookupStatus;
  action: PortalAction | null;
  firstName: string | null;
  email: string | null;
  lookupToken: string | null;
  /** Under-13 members only: the member's most recent DuesYear. */
  duesYear: number | null;
  /** Under-13 members only: the dues year that counts as current today. */
  requiredDuesYear: number | null;
  /** Under-13 members only: whether duesYear >= requiredDuesYear. */
  duesCurrent: boolean | null;
}

export interface DuesLinkResult {
  success: boolean;
  message: string;
  link: string | null;
  /** Returned so the page can be re-filled after the payment tab opens. */
  bsaId: string | null;
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

interface DuesLinkArgs {
  lookupToken: string;
}

type FieldName = 'lookupMember' | 'sendPortalInvite' | 'requestDuesLink';

/**
 * Amplify Data's generated resolver invokes the function with a flat payload
 * (`{ typeName, fieldName, arguments, identity, source, request, prev }`),
 * NOT the standard AppSync direct-Lambda event with `info.fieldName`. Accept
 * both so the handler works however AppSync invokes it.
 */
interface ResolverEvent<TArgs> {
  fieldName?: string;
  info?: { fieldName?: string };
  arguments?: TArgs;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: ResolverEvent<LookupArgs | InviteArgs | DuesLinkArgs>,
): Promise<LookupResult | InviteResult | DuesLinkResult> => {
  const field = (event.fieldName ?? event.info?.fieldName) as FieldName | undefined;
  const args = event.arguments ?? {};
  switch (field) {
    case 'lookupMember':
      return lookupMember(args as LookupArgs);
    case 'sendPortalInvite':
      return sendPortalInvite(args as InviteArgs);
    case 'requestDuesLink':
      return requestDuesLink(args as DuesLinkArgs);
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
  const action = portalAction(member, now);
  const dues = action === 'UNDER_AGE' ? duesStatus(member, now, DUES_TIMEZONE) : null;

  return {
    status: 'FOUND',
    action,
    firstName: clean(member.FirstName) || null,
    email: clean(member.EmailPrimaryAddress) || null,
    lookupToken: signLookupToken(bsaPersonId, now, await getTokenKey()),
    duesYear: dues?.duesYear ?? null,
    requiredDuesYear: dues?.requiredDuesYear ?? null,
    duesCurrent: dues?.current ?? null,
  };
}

async function findMembers(args: LookupArgs): Promise<MemberRecord[]> {
  const bsaId = clean(args.bsaId);
  if (bsaId) {
    if (!/^\d{1,12}$/.test(bsaId)) return [];
    return queryByBsaId(Number(bsaId));
  }

  const firstName = clean(args.firstName);
  const lastName = clean(args.lastName);
  const birthDate = clean(args.birthDate);
  if (!firstName || !lastName || !birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return [];
  }
  return findByNameAndBirthdate(firstName, lastName, birthDate);
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
 * The table is keyed on BsaPersonId only (and is owned by another stack, so we
 * don't add an index to it). Name + birthdate lookups therefore use a small
 * in-memory index of who-matches-what, rebuilt from one projected scan at most
 * every ROSTER_CACHE_TTL_SECONDS per Lambda container (see roster.ts) instead
 * of scanning the table on every public request. The matched member's record
 * is then read live by ID, so portal status and dues are never stale.
 */
const getRoster = createRosterCache(loadRoster, Number(ROSTER_CACHE_TTL_SECONDS) * 1000);

async function loadRoster() {
  const items: RosterItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: MEMBER_DATA_TABLE_NAME,
        ProjectionExpression: 'BsaPersonId, FirstName, LastName, DateOfBirth',
        ExclusiveStartKey,
      }),
    );
    items.push(...((page.Items ?? []) as RosterItem[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return buildRosterIndex(items);
}

async function findByNameAndBirthdate(
  firstName: string,
  lastName: string,
  birthDate: string,
): Promise<MemberRecord[]> {
  const ids = (await getRoster()).get(rosterKey(firstName, lastName, birthDate));
  if (!ids) return [];
  // Two people is already "ambiguous"; never fan out further than that.
  const found = await Promise.all([...ids].slice(0, 2).map(queryByBsaId));
  return found.flat();
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
  const age = ageOn(member.DateOfBirth, now, DUES_TIMEZONE);
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

function notFound(status: Exclude<LookupStatus, 'FOUND'>): LookupResult {
  return {
    status,
    action: null,
    firstName: null,
    email: null,
    lookupToken: null,
    duesYear: null,
    requiredDuesYear: null,
    duesCurrent: null,
  };
}

// ---------------------------------------------------------------------------
// sendPortalInvite
// ---------------------------------------------------------------------------

export async function sendPortalInvite(args: InviteArgs, now = new Date()): Promise<InviteResult> {
  if (!sideEffectsEnabled) return failure(SIDE_EFFECTS_DISABLED_MESSAGE);

  const email = clean(args.email).toLowerCase();
  if (!isValidEmail(email)) {
    return failure('Please enter a valid email address.');
  }

  const bsaPersonId = verifyLookupToken(args.lookupToken, now, await getTokenKey());
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

  const response = await callLodgeMaster<LodgeMasterInviteResponse>(
    'POST',
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
// requestDuesLink
// ---------------------------------------------------------------------------

/**
 * Returns the member's LodgeMaster dues-payment link. Only issued for the
 * exact case the UI offers it (under 13 with dues not current), re-checked
 * server-side, since the link is specific to that member.
 */
export async function requestDuesLink(
  args: DuesLinkArgs,
  now = new Date(),
): Promise<DuesLinkResult> {
  const duesFailure = (message: string): DuesLinkResult => ({
    success: false,
    message,
    link: null,
    bsaId: null,
  });

  if (!sideEffectsEnabled) return duesFailure(SIDE_EFFECTS_DISABLED_MESSAGE);

  const bsaPersonId = verifyLookupToken(args.lookupToken, now, await getTokenKey());
  if (bsaPersonId === null) {
    return duesFailure('Your session has expired. Please look yourself up again.');
  }

  const records = await queryByBsaId(bsaPersonId);
  if (records.length === 0) {
    return duesFailure('We could not find your member record. Please look yourself up again.');
  }
  const member = latestRecord(records);
  if (portalAction(member, now) !== 'UNDER_AGE' || duesStatus(member, now, DUES_TIMEZONE).current) {
    return duesFailure('Your dues are already up to date.');
  }
  if (!member.OalmId) {
    return duesFailure('Your member record is missing a LodgeMaster ID.');
  }

  const response = await callLodgeMaster<{ link?: string }>(
    'GET',
    `/api/members/dues/${encodeURIComponent(String(member.OalmId))}/memberdueslink`,
  );
  const link = response.link ?? '';
  if (!link.startsWith(`${DUES_LINK_ORIGIN}/`)) {
    console.error('Unexpected dues link from LodgeMaster', { hasLink: Boolean(link) });
    throw new Error('LodgeMaster did not return a dues payment link. Please try again later.');
  }

  return { success: true, message: 'Dues link created', link, bsaId: String(bsaPersonId) };
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

async function callLodgeMaster<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
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
    method,
    headers: lodgeMasterHeaders(cookies),
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    redirect: 'manual',
  });
  const text = await response.text();
  if (response.status !== 200) {
    console.error('LodgeMaster request failed', { path, status: response.status });
    throw new Error('LodgeMaster could not complete the request. Please try again later.');
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

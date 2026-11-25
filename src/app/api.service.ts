import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

export type LookupStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
export type PortalAction =
  'ACCOUNT_ACTIVE' | 'CREATE_ACCOUNT' | 'RESEND_INVITE' | 'UNDER_AGE' | 'UNKNOWN';

export interface MemberLookup {
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

export interface LookupArgs {
  bsaId?: string;
  firstName?: string;
  lastName?: string;
  /** ISO date, YYYY-MM-DD */
  birthDate?: string;
}

/**
 * Wrapper around the Amplify Data client for the Lambda-backed operations
 * defined in amplify/data/resource.ts. The client is created lazily so the
 * service can be constructed (e.g. in tests) before Amplify is configured.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private _client: ReturnType<typeof generateClient<Schema>> | undefined;

  private get client() {
    return (this._client ??= generateClient<Schema>());
  }

  async lookupMember(args: LookupArgs): Promise<MemberLookup> {
    const { data, errors } = await this.client.queries.lookupMember(args);
    if (errors?.length || !data) throw new Error(describe(errors));
    return data as MemberLookup;
  }

  async sendPortalInvite(lookupToken: string, email: string): Promise<InviteResult> {
    const { data, errors } = await this.client.mutations.sendPortalInvite({ lookupToken, email });
    if (errors?.length || !data) throw new Error(describe(errors));
    return data as InviteResult;
  }
}

function describe(errors: ReadonlyArray<{ message: string }> | undefined): string {
  return errors?.map((e) => e.message).join('; ') || 'No response from the server.';
}

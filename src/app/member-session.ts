import { Injectable, signal } from '@angular/core';

/**
 * Holds the signed lookup token and first name between the start page and the
 * events page. Kept in memory only (never in the URL or storage), so a reload
 * of the events page sends the member back to look themselves up again.
 */
@Injectable({ providedIn: 'root' })
export class MemberSession {
  readonly lookupToken = signal<string | null>(null);
  readonly firstName = signal<string | null>(null);

  set(lookupToken: string, firstName: string | null): void {
    this.lookupToken.set(lookupToken);
    this.firstName.set(firstName);
  }

  clear(): void {
    this.lookupToken.set(null);
    this.firstName.set(null);
  }
}

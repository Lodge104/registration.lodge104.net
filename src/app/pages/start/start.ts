import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ApiService, type MemberLookup } from '../../api.service';
import { CONTACT_EMAIL } from '../../site-config';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Oldest selectable birth year (matches the legacy site). */
const MIN_BIRTH_YEAR = 1927;
/** Youngest selectable age offset (legacy site showed current year − 12). */
const MIN_AGE_OFFSET = 12;

export const PORTAL_URL = 'https://portal.oa-scouting.org/';
export const SUPPORT_URL = 'https://support.lodge104.net';

/**
 * sessionStorage key used to re-fill the page after opening the dues payment
 * tab. Kept out of the URL so the BSA ID doesn't end up in browser history or
 * server logs. Cleared once read.
 */
export const DUES_PENDING_KEY = 'registration.duesPending';
/** Ignore a stale pending-dues entry older than this. */
const DUES_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

type Dialog = 'active' | 'invite' | 'done' | 'dues';

@Component({
  selector: 'app-start',
  imports: [ReactiveFormsModule],
  templateUrl: './start.html',
})
export class Start {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ApiService);

  protected readonly contactEmail = CONTACT_EMAIL;
  protected readonly months = MONTHS.map((label, i) => ({ value: String(i + 1), label }));
  protected readonly days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly years = (() => {
    const newest = new Date().getFullYear() - MIN_AGE_OFFSET;
    return Array.from({ length: newest - MIN_BIRTH_YEAR + 1 }, (_, i) => String(newest - i));
  })();

  // Field names mirror the legacy site's query parameters.
  protected readonly bsaIdForm = this.fb.group({
    bsaID: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
  });

  protected readonly nameForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    birthMonth: ['', Validators.required],
    birthDay: ['', Validators.required],
    birthYear: ['', Validators.required],
  });

  protected readonly bsaIdSubmitted = signal(false);
  protected readonly nameSubmitted = signal(false);

  /** True while a lookup request is in flight. */
  protected readonly loading = signal(false);
  /** Page-level message (not found, errors, under-age). */
  protected readonly notice = signal<string | null>(null);

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly member = signal<MemberLookup | null>(null);

  protected readonly emailControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email, Validators.maxLength(254)],
  });
  protected readonly inviteBusy = signal(false);
  protected readonly inviteError = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  protected readonly duesBusy = signal(false);
  protected readonly duesError = signal<string | null>(null);
  /** Shown when the payment tab could not be opened (e.g. pop-up blocked). */
  protected readonly duesLink = signal<string | null>(null);
  /** Info box after returning from the dues payment step. */
  protected readonly duesPending = signal(false);
  /** BSA ID returned with the dues link (also set when looked up by name). */
  private duesBsaId: string | null = null;

  constructor() {
    const pending = readDuesPending();
    if (pending) {
      this.bsaIdForm.setValue({ bsaID: pending.bsaId });
      this.duesPending.set(true);
    }
  }

  protected async verifyBsaId(): Promise<void> {
    this.bsaIdSubmitted.set(true);
    if (this.bsaIdForm.invalid) return;
    await this.lookup({ bsaId: this.bsaIdForm.getRawValue().bsaID.trim() });
  }

  protected async verifyNameBirthdate(): Promise<void> {
    this.nameSubmitted.set(true);
    if (this.nameForm.invalid) return;
    const v = this.nameForm.getRawValue();
    await this.lookup({
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      birthDate: `${v.birthYear}-${v.birthMonth.padStart(2, '0')}-${v.birthDay}`,
    });
  }

  private async lookup(args: Parameters<ApiService['lookupMember']>[0]): Promise<void> {
    this.notice.set(null);
    this.loading.set(true);
    try {
      const result = await this.api.lookupMember(args);
      this.member.set(result);

      if (result.status !== 'FOUND') {
        this.notice.set(
          `We could not find a matching record. Please email ${CONTACT_EMAIL} for help.`,
        );
        return;
      }

      switch (result.action) {
        case 'ACCOUNT_ACTIVE':
          this.dialog.set('active');
          break;
        case 'CREATE_ACCOUNT':
        case 'RESEND_INVITE':
          this.emailControl.setValue(result.email ?? '');
          this.emailControl.markAsUntouched();
          this.inviteError.set(null);
          this.dialog.set('invite');
          break;
        case 'UNDER_AGE':
          if (result.duesCurrent === false) {
            this.duesError.set(null);
            this.duesLink.set(null);
            this.dialog.set('dues');
          } else {
            this.notice.set(
              `Online portal accounts are available to members age 13 and older. Please email ${CONTACT_EMAIL} if you have questions.`,
            );
          }
          break;
        default:
          this.notice.set(
            `We found your record but cannot set up your account automatically. Please email ${CONTACT_EMAIL} for help.`,
          );
      }
    } catch (err) {
      console.error('lookupMember failed', err);
      this.notice.set(
        `Something went wrong while looking you up. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** "Active account" popup: yes → portal, no → support. */
  protected answerAware(aware: boolean): void {
    this.redirect(aware ? PORTAL_URL : SUPPORT_URL);
  }

  protected async submitInvite(): Promise<void> {
    this.emailControl.markAsTouched();
    const token = this.member()?.lookupToken;
    if (this.emailControl.invalid || !token) return;

    this.inviteError.set(null);
    this.inviteBusy.set(true);
    try {
      const result = await this.api.sendPortalInvite(token, this.emailControl.value.trim());
      if (result.success) {
        this.sentTo.set(result.email ?? this.emailControl.value.trim());
        this.dialog.set('done');
      } else {
        this.inviteError.set(result.message);
      }
    } catch (err) {
      console.error('sendPortalInvite failed', err);
      this.inviteError.set(
        `We could not send the email right now. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    } finally {
      this.inviteBusy.set(false);
    }
  }

  protected closeDialog(): void {
    this.dialog.set(null);
  }

  /**
   * Opens the member's LodgeMaster dues payment link in a new tab, then
   * reloads this page with the BSA ID filled in and a "check again" notice.
   *
   * The tab is opened synchronously on click (before the API call) so
   * pop-up blockers allow it; it is pointed at the link once it arrives.
   */
  protected async payDues(): Promise<void> {
    const token = this.member()?.lookupToken;
    if (!token) return;

    const tab = this.openTab();
    this.duesError.set(null);
    this.duesBusy.set(true);
    try {
      const result = await this.api.requestDuesLink(token);
      if (!result.success || !result.link) {
        tab?.close();
        this.duesError.set(result.message);
        return;
      }
      this.duesBsaId = result.bsaId;

      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = result.link;
      } else {
        // Pop-up blocked: let the member open it themselves.
        this.duesLink.set(result.link);
        return;
      }

      this.reloadWithDuesPending();
    } catch (err) {
      console.error('requestDuesLink failed', err);
      tab?.close();
      this.duesError.set(
        `We could not get your dues payment link right now. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    } finally {
      this.duesBusy.set(false);
    }
  }

  /** After opening the link manually (pop-up blocked), refresh this page. */
  protected continueAfterDuesLink(): void {
    this.reloadWithDuesPending();
  }

  private reloadWithDuesPending(): void {
    const bsaId = this.duesBsaId ?? this.bsaIdForm.getRawValue().bsaID.trim();
    if (/^\d{1,12}$/.test(bsaId)) {
      try {
        sessionStorage.setItem(DUES_PENDING_KEY, JSON.stringify({ bsaId, at: Date.now() }));
      } catch {
        // Storage unavailable (private mode): the page still reloads, just empty.
      }
    }
    this.reload();
  }

  /** Isolated so tests can stub reloading. */
  protected reload(): void {
    window.location.reload();
  }

  /** Isolated so tests can stub tab opening. */
  protected openTab(): Window | null {
    return window.open('', '_blank');
  }

  /** Isolated so tests can stub navigation. */
  protected redirect(url: string): void {
    window.location.assign(url);
  }

  protected invalid(form: 'bsaIdForm' | 'nameForm', control: string): boolean {
    const group: FormGroup = this[form];
    const submitted = form === 'bsaIdForm' ? this.bsaIdSubmitted() : this.nameSubmitted();
    const ctrl = group.get(control);
    return !!ctrl && ctrl.invalid && (submitted || ctrl.touched);
  }
}

/** Reads and clears the pending-dues entry left before a reload. */
function readDuesPending(): { bsaId: string } | null {
  try {
    const raw = sessionStorage.getItem(DUES_PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DUES_PENDING_KEY);
    const { bsaId, at } = JSON.parse(raw) as { bsaId?: unknown; at?: unknown };
    if (typeof bsaId !== 'string' || !/^\d{1,12}$/.test(bsaId)) return null;
    if (typeof at !== 'number' || Date.now() - at > DUES_PENDING_TTL_MS) return null;
    return { bsaId };
  } catch {
    return null;
  }
}

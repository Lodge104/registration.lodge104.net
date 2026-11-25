import { TestBed } from '@angular/core/testing';
import { ApiService, type InviteResult, type MemberLookup } from '../../api.service';
import { Start } from './start';

const found = (over: Partial<MemberLookup> = {}): MemberLookup => ({
  status: 'FOUND',
  action: 'CREATE_ACCOUNT',
  firstName: 'Pat',
  email: 'pat@example.com',
  lookupToken: 'token',
  ...over,
});

describe('Start', () => {
  const lookupMember = vi.fn<ApiService['lookupMember']>();
  const sendPortalInvite = vi.fn<ApiService['sendPortalInvite']>();

  beforeEach(async () => {
    lookupMember.mockReset();
    sendPortalInvite.mockReset();
    await TestBed.configureTestingModule({
      imports: [Start],
      providers: [{ provide: ApiService, useValue: { lookupMember, sendPortalInvite } }],
    }).compileComponents();
  });

  async function setup() {
    const fixture = TestBed.createComponent(Start);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const redirect = vi
      .spyOn(fixture.componentInstance as unknown as { redirect(u: string): void }, 'redirect')
      .mockImplementation(() => undefined);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const type = (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submitBsa = async (id = '1234567') => {
      type('#bsaID', id);
      el.querySelectorAll('form')[0].dispatchEvent(new Event('submit'));
      await settle();
    };
    return { fixture, el, redirect, settle, type, submitBsa };
  }

  it('renders both identification options', async () => {
    const { el } = await setup();
    expect(el.querySelector('h2')?.textContent).toContain('You have two ways to get started.');
    expect(el.querySelectorAll('form').length).toBe(2);
    expect(el.querySelector('#bsaID')).toBeTruthy();
    expect(el.querySelector('#firstName')).toBeTruthy();
    expect(el.querySelector('#lastName')).toBeTruthy();
  });

  it('lists 12 months, 31 days and birth years down to 1927', async () => {
    const { el } = await setup();
    const opts = (id: string) => el.querySelectorAll(`#${id} option:not([disabled])`);
    expect(opts('birthMonth').length).toBe(12);
    expect(opts('birthDay').length).toBe(31);
    const years = [...opts('birthYear')].map((o) => o.textContent?.trim());
    expect(years[0]).toBe(String(new Date().getFullYear() - 12));
    expect(years.at(-1)).toBe('1927');
  });

  it('validates an empty BSA ID without calling the API', async () => {
    const { el, settle } = await setup();
    el.querySelectorAll('form')[0].dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('#bsaID')?.classList).toContain('input-error');
    expect(lookupMember).not.toHaveBeenCalled();
  });

  it('shows the contact message when no member matches', async () => {
    lookupMember.mockResolvedValue({ ...found(), status: 'NOT_FOUND', action: null });
    const { el, submitBsa } = await setup();
    await submitBsa();
    expect(lookupMember).toHaveBeenCalledWith({ bsaId: '1234567' });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('registration@lodge104.net');
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('looks up by name and birthdate in YYYY-MM-DD form', async () => {
    lookupMember.mockResolvedValue({ ...found(), status: 'NOT_FOUND', action: null });
    const { el, type, settle } = await setup();
    type('#firstName', 'Pat');
    type('#lastName', 'Scout');
    for (const [id, value] of [
      ['birthMonth', '3'],
      ['birthDay', '09'],
      ['birthYear', '2000'],
    ]) {
      const select = el.querySelector<HTMLSelectElement>(`#${id}`)!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
    }
    el.querySelectorAll('form')[1].dispatchEvent(new Event('submit'));
    await settle();
    expect(lookupMember).toHaveBeenCalledWith({
      firstName: 'Pat',
      lastName: 'Scout',
      birthDate: '2000-03-09',
    });
  });

  it('active account: "Yes" goes to the portal, "No" goes to support', async () => {
    lookupMember.mockResolvedValue(found({ action: 'ACCOUNT_ACTIVE' }));
    const { el, redirect, submitBsa } = await setup();
    await submitBsa();

    expect(el.querySelector('.modal')?.textContent).toContain('already have an active');
    const [no, yes] = [...el.querySelectorAll<HTMLButtonElement>('.modal button')];
    yes.click();
    expect(redirect).toHaveBeenLastCalledWith('https://portal.oa-scouting.org/');
    no.click();
    expect(redirect).toHaveBeenLastCalledWith('https://support.lodge104.net');
  });

  it.each(['CREATE_ACCOUNT', 'RESEND_INVITE'] as const)(
    '%s: pre-fills the email, sends the invite, then shows the confirmation',
    async (action) => {
      lookupMember.mockResolvedValue(found({ action }));
      sendPortalInvite.mockResolvedValue({
        success: true,
        message: 'Invitation Sent',
        email: 'pat@example.com',
        expiresAt: null,
      } satisfies InviteResult);
      const { el, submitBsa, settle } = await setup();
      await submitBsa();

      const email = el.querySelector<HTMLInputElement>('#inviteEmail')!;
      expect(email.value).toBe('pat@example.com');

      el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
      await settle();

      expect(sendPortalInvite).toHaveBeenCalledWith('token', 'pat@example.com');
      expect(el.querySelector('.modal')?.textContent).toContain('follow the directions');
      expect(el.querySelector('.modal')?.textContent).toContain('pat@example.com');
    },
  );

  it('does not send an invalid email address', async () => {
    lookupMember.mockResolvedValue(found({ email: null }));
    const { el, submitBsa, settle, type } = await setup();
    await submitBsa();

    expect(el.querySelector<HTMLInputElement>('#inviteEmail')!.value).toBe('');
    type('#inviteEmail', 'not-an-email');
    el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(sendPortalInvite).not.toHaveBeenCalled();
    expect(el.querySelector('.modal')?.textContent).toContain('valid email');
  });

  it('keeps the popup open and shows the message when the invite fails', async () => {
    lookupMember.mockResolvedValue(found());
    sendPortalInvite.mockResolvedValue({
      success: false,
      message: 'Your session has expired. Please look yourself up again.',
      email: null,
      expiresAt: null,
    });
    const { el, submitBsa, settle } = await setup();
    await submitBsa();
    el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal')?.textContent).toContain('session has expired');
  });

  it('explains when the member is under 13', async () => {
    lookupMember.mockResolvedValue(found({ action: 'UNDER_AGE' }));
    const { el, submitBsa } = await setup();
    await submitBsa();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('13');
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('shows a friendly error when the lookup request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    lookupMember.mockRejectedValue(new Error('boom'));
    const { el, submitBsa } = await setup();
    await submitBsa();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');
  });
});

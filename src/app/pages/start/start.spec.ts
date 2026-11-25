import { TestBed } from '@angular/core/testing';
import { ApiService, type InviteResult, type MemberLookup } from '../../api.service';
import { DUES_PENDING_KEY, Start } from './start';

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
  const requestDuesLink = vi.fn<ApiService['requestDuesLink']>();

  beforeEach(async () => {
    lookupMember.mockReset();
    sendPortalInvite.mockReset();
    requestDuesLink.mockReset();
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Start],
      providers: [
        {
          provide: ApiService,
          useValue: { lookupMember, sendPortalInvite, requestDuesLink },
        },
      ],
    }).compileComponents();
  });

  async function setup() {
    const fixture = TestBed.createComponent(Start);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance as unknown as {
      redirect(u: string): void;
      reload(): void;
      openTab(): Window | null;
    };
    const redirect = vi.spyOn(component, 'redirect').mockImplementation(() => undefined);
    const reload = vi.spyOn(component, 'reload').mockImplementation(() => undefined);
    const fakeTab = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() };
    const openTab = vi
      .spyOn(component, 'openTab')
      .mockImplementation(() => fakeTab as unknown as Window);
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
    return { fixture, el, redirect, reload, openTab, fakeTab, settle, type, submitBsa };
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

  describe('under 13 dues', () => {
    const behind = () =>
      found({ action: 'UNDER_AGE', duesYear: 2025, requiredDuesYear: 2027, duesCurrent: false });
    const pay = (el: HTMLElement) =>
      [...el.querySelectorAll<HTMLButtonElement>('.modal button')]
        .find((b) => b.textContent?.includes('Pay dues'))!
        .click();

    it('shows the under-13 message (no popup) when dues are current', async () => {
      lookupMember.mockResolvedValue(found({ action: 'UNDER_AGE', duesCurrent: true }));
      const { el, submitBsa } = await setup();
      await submitBsa();
      expect(el.querySelector('.modal')).toBeNull();
      expect(el.querySelector('[role=alert]')?.textContent).toContain('13');
    });

    it('shows the dues popup when dues are behind', async () => {
      lookupMember.mockResolvedValue(behind());
      const { el, submitBsa } = await setup();
      await submitBsa();
      const modal = el.querySelector('.modal')?.textContent ?? '';
      expect(modal).toContain('pay your lodge');
      expect(modal).toContain('2027');
      expect(modal).toContain('2025');
    });

    it('opens the dues link in a new tab, then reloads with the BSA ID saved', async () => {
      lookupMember.mockResolvedValue(behind());
      requestDuesLink.mockResolvedValue({
        success: true,
        message: 'ok',
        link: 'https://members.oa-scouting.org/link/member?token=abc',
        bsaId: '1234567',
      });
      const { el, submitBsa, settle, openTab, fakeTab, reload } = await setup();
      await submitBsa();
      pay(el);
      await settle();

      expect(openTab).toHaveBeenCalledTimes(1);
      expect(requestDuesLink).toHaveBeenCalledWith('token');
      expect(fakeTab.location.href).toBe('https://members.oa-scouting.org/link/member?token=abc');
      expect(fakeTab.opener).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(JSON.parse(sessionStorage.getItem(DUES_PENDING_KEY)!).bsaId).toBe('1234567');
    });

    it('offers a manual link when the browser blocks the new tab', async () => {
      lookupMember.mockResolvedValue(behind());
      requestDuesLink.mockResolvedValue({
        success: true,
        message: 'ok',
        link: 'https://members.oa-scouting.org/link/member?token=abc',
        bsaId: '1234567',
      });
      const { el, submitBsa, settle, openTab, reload } = await setup();
      openTab.mockReturnValue(null);
      await submitBsa();
      pay(el);
      await settle();

      const link = el.querySelector<HTMLAnchorElement>('.modal a[target=_blank]')!;
      expect(link.href).toBe('https://members.oa-scouting.org/link/member?token=abc');
      expect(reload).not.toHaveBeenCalled();

      [...el.querySelectorAll<HTMLButtonElement>('.modal button')]
        .find((b) => b.textContent?.includes('Done'))!
        .click();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('closes the blank tab and shows the message when no link is returned', async () => {
      lookupMember.mockResolvedValue(behind());
      requestDuesLink.mockResolvedValue({
        success: false,
        message: 'Your dues are already up to date.',
        link: null,
        bsaId: null,
      });
      const { el, submitBsa, settle, fakeTab, reload } = await setup();
      await submitBsa();
      pay(el);
      await settle();

      expect(fakeTab.close).toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(el.querySelector('.modal')?.textContent).toContain('already up to date');
    });

    it('after reload, re-fills the BSA ID and shows the check-again box', async () => {
      sessionStorage.setItem(
        DUES_PENDING_KEY,
        JSON.stringify({ bsaId: '1234567', at: Date.now() }),
      );
      const { el } = await setup();

      expect(el.querySelector<HTMLInputElement>('#bsaID')!.value).toBe('1234567');
      expect(el.querySelector('[role=status]')?.textContent).toContain('15 minutes');
      expect(sessionStorage.getItem(DUES_PENDING_KEY)).toBeNull();
    });

    it('ignores a stale or malformed pending entry', async () => {
      sessionStorage.setItem(
        DUES_PENDING_KEY,
        JSON.stringify({ bsaId: '1234567', at: Date.now() - 2 * 24 * 60 * 60 * 1000 }),
      );
      const { el } = await setup();
      expect(el.querySelector<HTMLInputElement>('#bsaID')!.value).toBe('');
      expect(el.querySelector('[role=status]')).toBeNull();
    });
  });

  it('shows a friendly error when the lookup request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    lookupMember.mockRejectedValue(new Error('boom'));
    const { el, submitBsa } = await setup();
    await submitBsa();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');
  });
});

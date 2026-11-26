import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  ApiService,
  type ActiveOrdeal,
  type EventListResult,
  type RegistrationEvent,
} from '../../api.service';
import { MemberSession } from '../../member-session';
import { Events } from './events';

const event = (over: Partial<RegistrationEvent> = {}): RegistrationEvent => ({
  id: '1000000191',
  name: '2027 NOAC',
  location: 'Out of Council',
  startDateTime: '2027-07-26T13:00:00.0000000Z',
  endDateTime: '2027-08-01T13:00:00.0000000Z',
  alreadyRegistered: false,
  ...over,
});
const LINK = 'https://members.oa-scouting.org/link/member?token=abc';

describe('Events', () => {
  const listEvents = vi.fn<ApiService['listEvents']>();
  const requestEventRegistrationLink = vi.fn<ApiService['requestEventRegistrationLink']>();

  beforeEach(async () => {
    listEvents.mockReset();
    requestEventRegistrationLink.mockReset();
    await TestBed.configureTestingModule({
      imports: [Events],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { listEvents, requestEventRegistrationLink } },
      ],
    }).compileComponents();
  });

  async function setup(result: EventListResult | null, token: string | null = 'signed-token') {
    const session = TestBed.inject(MemberSession);
    session.clear();
    if (token) session.set(token, 'Pat');
    if (result) listEvents.mockResolvedValue(result);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(Events);
    const fakeTab = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() };
    const component = fixture.componentInstance as unknown as { openTab(): Window | null };
    const openTab = vi
      .spyOn(component, 'openTab')
      .mockImplementation(() => fakeTab as unknown as Window);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { el: fixture.nativeElement as HTMLElement, navigate, openTab, fakeTab, settle };
  }

  const list = (
    events: RegistrationEvent[],
    candidate = false,
    activeOrdeal: ActiveOrdeal | null = null,
  ): EventListResult => ({
    success: true,
    message: 'ok',
    candidate,
    events,
    activeOrdeal,
  });

  it('sends the member back to the start page when there is no session', async () => {
    const { navigate } = await setup(null, null);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('shows a table with name, location, date and a Register button', async () => {
    const { el } = await setup(list([event()]));
    expect(listEvents).toHaveBeenCalledWith('signed-token');
    const row = el.querySelector('tbody tr')!;
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells[0]).toBe('2027 NOAC');
    expect(cells[1]).toBe('Out of Council');
    expect(cells[2]).toBe('Mon, Jul 26 – Sun, Aug 1, 2027');
    expect(row.querySelector('button')?.textContent).toContain('Register');
  });

  it('shows a single date for a one-day event and a dash for a missing location', async () => {
    const { el } = await setup(
      list([
        event({
          location: null,
          startDateTime: '2026-12-18T00:00:00.0000000Z',
          endDateTime: '2026-12-18T02:00:00.0000000Z',
        }),
      ]),
    );
    const cells = [...el.querySelectorAll('tbody td')].map((td) => td.textContent?.trim());
    expect(cells[1]).toBe('—');
    // 00:00 UTC on Dec 18 is still Dec 17 in the lodge's time zone.
    expect(cells[2]).toBe('Thu, Dec 17, 2026');
  });

  it('opens the registration link in a new tab', async () => {
    requestEventRegistrationLink.mockResolvedValue({ success: true, message: 'ok', link: LINK });
    const { el, settle, openTab, fakeTab } = await setup(list([event()]));
    el.querySelector<HTMLButtonElement>('tbody button')!.click();
    await settle();

    expect(openTab).toHaveBeenCalledTimes(1);
    expect(requestEventRegistrationLink).toHaveBeenCalledWith('signed-token', '1000000191');
    expect(fakeTab.location.href).toBe(LINK);
    expect(fakeTab.opener).toBeNull();
  });

  it('offers a manual link when the pop-up is blocked', async () => {
    requestEventRegistrationLink.mockResolvedValue({ success: true, message: 'ok', link: LINK });
    const { el, settle, openTab } = await setup(list([event()]));
    openTab.mockReturnValue(null);
    el.querySelector<HTMLButtonElement>('tbody button')!.click();
    await settle();
    expect(el.querySelector<HTMLAnchorElement>('tbody a[target=_blank]')?.href).toBe(LINK);
  });

  it('closes the blank tab and shows the message when no link is returned', async () => {
    requestEventRegistrationLink.mockResolvedValue({
      success: false,
      message: 'Registration for that event is not open right now.',
      link: null,
    });
    const { el, settle, fakeTab } = await setup(list([event()]));
    el.querySelector<HTMLButtonElement>('tbody button')!.click();
    await settle();
    expect(fakeTab.close).toHaveBeenCalled();
    expect(el.querySelector('tbody [role=alert]')?.textContent).toContain('not open');
  });

  it('shows an empty state when nothing is open', async () => {
    const { el } = await setup(list([]));
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelector('[role=status]')?.textContent).toContain(
      'no events open for online registration',
    );
  });

  it('shows the server message when the list is refused', async () => {
    const { el } = await setup({
      success: false,
      message: 'Your session has expired. Please look yourself up again.',
      candidate: false,
      events: [],
      activeOrdeal: null,
    });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('session has expired');
  });

  it('shows an "already registered" warning instead of the Register button', async () => {
    const { el } = await setup(
      list([event({ id: '1', name: 'Banquet' }), event({ id: '2', alreadyRegistered: true })]),
    );
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('button')?.textContent).toContain('Register');
    expect(rows[1].querySelector('button')).toBeNull();
    expect(rows[1].textContent).toContain('Already registered');
  });

  describe('candidates', () => {
    const inductions = [
      event({ id: '1', name: 'Spring Ordeal', startDateTime: '2027-04-09T22:00:00Z' }),
      event({ id: '2', name: 'Fall Ordeal', startDateTime: '2027-10-08T22:00:00Z' }),
    ];

    it('lists Ordeal inductions to choose from, with Register disabled until one is picked', async () => {
      const { el } = await setup(list(inductions, true));
      expect(el.querySelector('h2')?.textContent).toContain('Choose your Ordeal');
      expect(el.querySelector('table')).toBeNull();
      expect(el.querySelectorAll('input[type=radio]').length).toBe(2);
      expect(el.querySelector<HTMLButtonElement>('button.btn')!.disabled).toBe(true);
    });

    it('fetches the link for the chosen induction', async () => {
      requestEventRegistrationLink.mockResolvedValue({ success: true, message: 'ok', link: LINK });
      const { el, settle, fakeTab } = await setup(list(inductions, true));
      const radios = el.querySelectorAll<HTMLInputElement>('input[type=radio]');
      radios[1].click();
      await settle();
      const button = el.querySelector<HTMLButtonElement>('button.btn')!;
      expect(button.disabled).toBe(false);
      button.click();
      await settle();

      expect(requestEventRegistrationLink).toHaveBeenCalledWith('signed-token', '2');
      expect(fakeTab.location.href).toBe(LINK);
    });

    it('pre-selects the only induction when there is just one', async () => {
      const { el } = await setup(list([inductions[0]], true));
      expect(el.querySelector<HTMLInputElement>('input[type=radio]')!.checked).toBe(true);
      expect(el.querySelector<HTMLButtonElement>('button.btn')!.disabled).toBe(false);
    });

    it('explains when no Ordeal inductions are open', async () => {
      const { el } = await setup(list([], true));
      expect(el.querySelector('[role=status]')?.textContent).toContain('no Ordeal inductions');
    });

    it('blocks every other Ordeal while one registration is unfinished', async () => {
      const held: ActiveOrdeal = {
        id: '1',
        name: 'Spring Ordeal',
        startDateTime: '2027-04-09T22:00:00Z',
        endDateTime: '2027-04-11T16:00:00Z',
      };
      const { el } = await setup(
        list([{ ...inductions[0], alreadyRegistered: true }, inductions[1]], true, held),
      );
      const notice = el.querySelector('[data-testid=active-ordeal]')!;
      expect(notice.textContent).toContain("You're already registered for");
      expect(notice.textContent).toContain('Spring Ordeal');
      expect(notice.textContent).toContain('Fri, Apr 9 – Sun, Apr 11, 2027');
      expect(el.querySelectorAll('input[type=radio]').length).toBe(0);
      expect(el.querySelector('button.btn')).toBeNull();
    });

    it('blocks the candidate even if the held Ordeal is no longer open for registration', async () => {
      const held: ActiveOrdeal = {
        id: '9',
        name: 'Winter Ordeal',
        startDateTime: '2027-01-15T22:00:00Z',
        endDateTime: '2027-01-17T16:00:00Z',
      };
      const { el } = await setup(list(inductions, true, held));
      expect(el.querySelector('[data-testid=active-ordeal]')?.textContent).toContain(
        'Winter Ordeal',
      );
      expect(el.querySelectorAll('input[type=radio]').length).toBe(0);
    });
  });

  it('shows all events normally once the member is no longer a candidate', async () => {
    // Server reports candidate=false (e.g. Level is now Ordeal), even though
    // they are registered for an Ordeal that hasn't ended.
    const { el } = await setup(
      list([
        event({ id: '1', name: 'Spring Ordeal', alreadyRegistered: true }),
        event({ id: '2', name: 'Fall Fellowship' }),
      ]),
    );
    expect(el.querySelector('[data-testid=active-ordeal]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelectorAll('tbody button').length).toBe(1);
  });
});

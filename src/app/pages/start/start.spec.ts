import { TestBed } from '@angular/core/testing';
import { Start } from './start';

describe('Start', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Start] }).compileComponents();
  });

  it('renders both identification options', async () => {
    const fixture = TestBed.createComponent(Start);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h2')?.textContent).toContain('You have two ways to get started.');
    expect(el.querySelectorAll('form').length).toBe(2);
    expect(el.querySelector('#bsaID')).toBeTruthy();
    expect(el.querySelector('#firstName')).toBeTruthy();
    expect(el.querySelector('#lastName')).toBeTruthy();
  });

  it('lists 12 months, 31 days and birth years down to 1927', async () => {
    const fixture = TestBed.createComponent(Start);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const opts = (id: string) => el.querySelectorAll(`#${id} option:not([disabled])`);

    expect(opts('birthMonth').length).toBe(12);
    expect(opts('birthDay').length).toBe(31);
    const years = [...opts('birthYear')].map((o) => o.textContent?.trim());
    expect(years[0]).toBe(String(new Date().getFullYear() - 12));
    expect(years.at(-1)).toBe('1927');
  });

  it('shows a validation error when BSA ID is submitted empty', async () => {
    const fixture = TestBed.createComponent(Start);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('form button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('#bsaID')?.classList).toContain('input-error');
  });
});

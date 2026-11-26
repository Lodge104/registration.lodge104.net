import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render a router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('should render the lodge header and contact footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')?.textContent).toContain(
      'Occoneechee Lodge #104 Online Registration',
    );
    expect(compiled.querySelector('a[href="mailto:registration@lodge104.net"]')).toBeTruthy();
    expect(compiled.querySelector('a[href="mailto:registration@lodge104.com"]')).toBeNull();
    expect(
      compiled.querySelector('a[href="https://lodge104.net/registration/refunds/"]'),
    ).toBeTruthy();
  });
});

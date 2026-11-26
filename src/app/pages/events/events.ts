import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type ActiveOrdeal, type RegistrationEvent } from '../../api.service';
import { MemberSession } from '../../member-session';
import { CONTACT_EMAIL } from '../../site-config';

const LODGE_TIMEZONE = 'America/New_York';

/**
 * Upcoming events an under-13 member with current dues can register for.
 * Candidates only see Ordeal inductions and choose one; everyone else gets a
 * table with a Register button per event. Each button fetches that member's
 * LodgeMaster registration link and opens it in a new tab.
 */
@Component({
  selector: 'app-events',
  imports: [RouterLink],
  templateUrl: './events.html',
})
export class Events implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(MemberSession);
  private readonly router = inject(Router);

  protected readonly contactEmail = CONTACT_EMAIL;
  protected readonly firstName = this.session.firstName;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<RegistrationEvent[]>([]);
  protected readonly candidate = signal(false);
  /** Candidates: the unfinished Ordeal they already hold (blocks all others). */
  protected readonly activeOrdeal = signal<ActiveOrdeal | null>(null);
  /** Ordeals a candidate may still pick (none while they hold one). */
  protected readonly selectableEvents = computed(() =>
    this.activeOrdeal() ? [] : this.events().filter((e) => !e.alreadyRegistered),
  );

  /** Event currently fetching its link. */
  protected readonly busyEventId = signal<string | null>(null);
  /** Candidate's chosen Ordeal induction. */
  protected readonly selectedEventId = signal<string | null>(null);
  /** Per-event problem (link failed or pop-up blocked). */
  protected readonly rowError = signal<{ eventId: string; message: string } | null>(null);
  /** Manual link when the browser blocked the new tab. */
  protected readonly blockedLink = signal<{ eventId: string; link: string } | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.session.lookupToken();
    if (!token) {
      // Reloaded or opened directly: there is no member to list events for.
      await this.router.navigateByUrl('/');
      return;
    }
    try {
      const result = await this.api.listEvents(token);
      if (!result.success) {
        this.error.set(result.message);
        return;
      }
      this.events.set(result.events);
      this.candidate.set(result.candidate);
      this.activeOrdeal.set(result.candidate ? result.activeOrdeal : null);
      const selectable = this.selectableEvents();
      if (result.candidate && selectable.length === 1) {
        this.selectedEventId.set(selectable[0].id);
      }
    } catch (err) {
      console.error('listEvents failed', err);
      this.error.set(
        `We could not load upcoming events. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected selectEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.rowError.set(null);
    this.blockedLink.set(null);
  }

  /** Candidates: register for the selected Ordeal induction. */
  protected async registerSelected(): Promise<void> {
    const eventId = this.selectedEventId();
    if (eventId) await this.register(eventId);
  }

  /**
   * Opens a blank tab synchronously on click (so pop-up blockers allow it),
   * fetches the member's registration link, then points the tab at it.
   */
  protected async register(eventId: string): Promise<void> {
    const token = this.session.lookupToken();
    if (!token || this.busyEventId()) return;
    if (this.events().find((e) => e.id === eventId)?.alreadyRegistered) return;

    const tab = this.openTab();
    this.rowError.set(null);
    this.blockedLink.set(null);
    this.busyEventId.set(eventId);
    try {
      const result = await this.api.requestEventRegistrationLink(token, eventId);
      if (!result.success || !result.link) {
        tab?.close();
        this.rowError.set({ eventId, message: result.message });
        return;
      }
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = result.link;
      } else {
        this.blockedLink.set({ eventId, link: result.link });
      }
    } catch (err) {
      console.error('requestEventRegistrationLink failed', err);
      tab?.close();
      this.rowError.set({
        eventId,
        message: `We could not get your registration link. Please try again, or email ${CONTACT_EMAIL}.`,
      });
    } finally {
      this.busyEventId.set(null);
    }
  }

  protected startOver(): void {
    this.session.clear();
  }

  /** "Sat, Dec 5, 2026" (one day) or "Sat, Dec 5 – Sun, Dec 6, 2026", in lodge time. */
  protected formatDates(event: RegistrationEvent): string {
    return this.formatRange(event.startDateTime, event.endDateTime);
  }

  protected formatRange(startIso: string | null, endIso: string | null): string {
    if (!startIso) return '';
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : null;
    const day = (d: Date, withYear: boolean) =>
      d.toLocaleDateString('en-US', {
        timeZone: LODGE_TIMEZONE,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
      });
    if (Number.isNaN(start.getTime())) return '';
    if (!end || Number.isNaN(end.getTime()) || day(start, true) === day(end, true)) {
      return day(start, true);
    }
    return `${day(start, false)} – ${day(end, true)}`;
  }

  /** Isolated so tests can stub tab opening. */
  protected openTab(): Window | null {
    return window.open('', '_blank');
  }
}

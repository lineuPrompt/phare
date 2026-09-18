import { businessToday, DEFAULT_HOUSEHOLD_TIMEZONE } from '@phare/core';
import type { AccountsResponse, TimelineResponse, TimezoneResponse } from './timeline';

// ---------------------------------------------------------------------------
// Loading the Timeline screen: three requests, one outcome.
//
// SEPARATE FROM api.ts AND FROM THE SCREEN, for the reason apiErrors.ts gives
// — api.ts imports the Supabase client, which imports react-native, so
// anything touching it is unreachable from a Node test runner. The `get` here
// is injected, which is what lets the pageView rule below be tested at all.
//
// WHY THREE REQUESTS. /api/timeline needs `account=<chequing id>`, which only
// /api/accounts knows, and it does not return the household's "today" — the
// route resolves that server-side from the household timezone and keeps it.
// So the timezone route supplies what businessToday() needs, exactly as the
// web app's useBusinessToday() hook does for the web page.
//
// TIMEZONE FAILURE IS NOT SWALLOWED. The web hook falls back to
// America/Toronto on any error. Here it propagates: every screen state below
// depends on which day it is (which month to slice, which row is today, where
// the projection begins), and quietly guessing that is how a household in
// another zone reads a wrong ledger with no indication anything failed. The
// fallback is used only when the route answers without a usable value.
// ---------------------------------------------------------------------------

export type Getter = <T>(path: string) => Promise<T>;

export type TimelineLoad =
  | { kind: 'ready'; data: Extract<TimelineResponse, { ok: true }>; today: string; timezone: string }
  /** No chequing account — the Timeline is chequing-scoped, so there is nothing to draw. */
  | { kind: 'noChequing' }
  /** The household has never anchored a real balance. Read-only here: the web app sets it. */
  | { kind: 'noAnchor' };

/** 'open' sends the funnel marker; 'refresh' never does. See createTimelineLoader. */
export type LoadTrigger = 'open' | 'refresh';

export function timelinePath(accountId: string, pageView: boolean): string {
  return `/api/timeline?account=${encodeURIComponent(accountId)}${pageView ? '&pageView=1' : ''}`;
}

/**
 * One loader per mounted screen.
 *
 * THE pageView RULE. `pageView=1` is what makes the route log
 * `timeline_opened`, the retention signal the funnel work exists to collect
 * (eventLogger.ts). The web page sends it once per mount because month
 * navigation re-slices client-side; pull-to-refresh here would otherwise log a
 * second, third, tenth "open" for one session and quietly inflate the metric
 * against web's meaning of it.
 *
 * The flag is set when the request is ISSUED, not when it succeeds: the route
 * logs the event before it does anything that could fail, so a 500 still
 * counted as an open. But a failure BEFORE the timeline request — no session,
 * /api/accounts down — never reached the route, so the next attempt still
 * carries the marker.
 */
export function createTimelineLoader(get: Getter, at: () => Date = () => new Date()) {
  let pageViewSent = false;

  return {
    /** For tests and diagnostics: has the funnel marker gone out yet? */
    get pageViewSent() {
      return pageViewSent;
    },

    async load(trigger: LoadTrigger): Promise<TimelineLoad> {
      // Independent, so they go together rather than in series.
      const [accounts, timezone] = await Promise.all([
        get<AccountsResponse>('/api/accounts'),
        get<TimezoneResponse>('/api/household/timezone'),
      ]);

      const chequing = accounts.accounts.find((account) => account.type === 'chequing');
      if (!chequing) return { kind: 'noChequing' };

      const zone = timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE;
      const today = businessToday(zone, at());

      const withMarker = trigger === 'open' && !pageViewSent;
      if (withMarker) pageViewSent = true;

      const data = await get<TimelineResponse>(timelinePath(chequing.id, withMarker));
      if (!data.ok) return { kind: 'noAnchor' };

      return { kind: 'ready', data, today, timezone: zone };
    },
  };
}

export type TimelineLoader = ReturnType<typeof createTimelineLoader>;

import { apiGet } from './api';
import type { DipInfo, TimelineDay, UnbalancedDay } from '@phare/core';

// ---------------------------------------------------------------------------
// GET /api/timeline — the chequing account's running-balance ledger.
//
// PINNED TO A REAL RESPONSE, NOT TO THE ROUTE'S TYPES. Verified live on
// 2026-09-17 against the route with a device bearer token: 57 request shapes,
// every transport (cookie, `Bearer`, `bearer`, `BEARER` + trailing space,
// bearer beside a junk cookie) returning a byte-identical 81,684-byte body.
// The keys below are the keys that payload actually had:
//
//   balancesStartDate, closingBalance, days, dip, horizonEndMonth, isPro,
//   nextIncomeDate, ok, openingBalance, plan, todayBalance, unbalancedDays
//
// UNLIKE reviews.ts, THE DAY TYPES ARE IMPORTED RATHER THAN RE-DECLARED.
// TimelineDay / DipInfo / UnbalancedDay moved into @phare/core (2026-09-15)
// precisely so this app and the web page read one definition; the web app
// re-exports them from src/lib/timelineHelpers.ts for its own consumers. Only
// the ROUTE ENVELOPE is declared here, because that belongs to the route.
//
// `plan` IS PRESENT AND NULL. The chained 12-month projection is opt-in via
// includePlan=1, which this app does not send, so the field arrives as null.
// It is deliberately not in the type: a field typed as possibly-populated
// invites a screen to read it, and the only honest value here is "absent".
// ---------------------------------------------------------------------------

export type TimelineOk = {
  ok: true;
  /** First date with a known balance. May be after the 1st of the month. */
  balancesStartDate: string;
  openingBalance: number;
  closingBalance: number;
  /** Null when today falls outside the returned window. */
  todayBalance: number | null;
  /** Every day in the window, including days with no entries. */
  days: TimelineDay[];
  /** Lowest end-of-day balance between today and the next pay, or null. */
  dip: DipInfo | null;
  /** The pay date the dip window ends on. Null exactly when dip is null. */
  nextIncomeDate: string | null;
  /** Real entries before balancesStartDate — no balance can be shown for them. */
  unbalancedDays: UnbalancedDay[];
  /**
   * Last month this household is entitled to see projected. Optional because
   * an older deployment may not send it; the screen treats its absence as
   * "no cap known" and shows only what it would have shown anyway.
   */
  horizonEndMonth?: string;
  isPro?: boolean;
};

export type TimelineResponse = TimelineOk | { ok: false; reason: 'no_anchor' };

/** GET /api/accounts. Only the fields the Timeline needs. */
export type AccountsResponse = {
  accounts: { id: string; name: string; type: string }[];
};

/** GET /api/household/timezone — the IANA zone "today" is resolved in. */
export type TimezoneResponse = { timezone: string };

export const fetchAccounts = () => apiGet<AccountsResponse>('/api/accounts');

export const fetchTimezone = () => apiGet<TimezoneResponse>('/api/household/timezone');

/**
 * `pageView=1` marks a genuine screen open, which makes the route log one
 * `timeline_opened` event. See timelinePath() in timelineLoader.ts for when
 * that flag is sent and why pull-to-refresh must not send it.
 */
export const fetchTimeline = (path: string) => apiGet<TimelineResponse>(path);

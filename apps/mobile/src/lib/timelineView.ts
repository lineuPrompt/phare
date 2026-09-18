import {
  buildMonthView,
  classifyDip,
  formatCADLocale,
  type DipStatus,
  type MonthView,
  type TimelineDay,
  type TimelineEntry,
  type UnbalancedDay,
} from '@phare/core';
import type { TimelineOk } from './timeline';
import type { Locale } from '../i18n';

// ---------------------------------------------------------------------------
// The Timeline screen's view model. Pure: no React, no react-native, no fetch.
//
// WHAT IS SHARED WITH THE WEB PAGE AND WHAT IS NOT.
//
// Shared, from @phare/core: buildMonthView (the month's opens/closes/lowest
// and which days are visible) and classifyDip (the healthy/amber/red tiers).
// Both surfaces therefore colour the same dip the same way and cannot drift —
// that is why they moved into the package rather than being copied here.
//
// Not shared: this file. The web page renders a month at a time with
// Previous/Next navigation; this screen renders THE CURRENT MONTH ONLY, plus
// a run-on to the next pay date (below). Month navigation is deliberately out
// of V1 scope.
//
// THE RUN-ON, AND WHY IT EXISTS. The header's dip answers "will I dip before
// payday" and is anchored to today, not to the month — so when the next pay
// falls in the NEXT month (ordinary on biweekly pay late in a month), the dip
// it names can sit on a date a current-month ledger does not contain. A banner
// naming 30 September above a ledger that stops on the 30th is one thing; a
// banner naming 2 October above the same ledger is a figure the user cannot
// check. So the ledger continues past the month's end, up to and including
// nextIncomeDate, under its own divider.
//
// THE RUN-ON IS CAPPED AT horizonEndMonth. The route returns all twelve
// months of days regardless of entitlement — it trims only what the web page
// may NAVIGATE to — so running on without a cap would show a free household
// projected days beyond the horizon its own web app withholds. The month strip
// stays month-scoped throughout: opensAt/closesAt/lowest describe the current
// month and nothing else.
//
// THE DIP'S OWN DAY IS ALWAYS SHOWN, even when it carries no entries — a flat
// day inherits the previous balance, so the month's low can legitimately land
// on an empty day, and hiding the very date the banner names would defeat the
// point. This is a small, deliberate divergence from the web page, which shows
// only days with entries.
// ---------------------------------------------------------------------------

export type LedgerRow =
  /** A pre-anchor day: real entries, no balance to attach them to. */
  | { kind: 'unbalanced'; day: UnbalancedDay }
  /** Note under the unbalanced block: balances start on this date. */
  | { kind: 'balancesBegin'; date: string }
  /** The boundary between what happened and what is only projected. */
  | { kind: 'projection' }
  /** Everything below belongs to a later month, up to this pay date. */
  | { kind: 'runOn'; payday: string }
  | { kind: 'day'; day: TimelineDay; isToday: boolean };

export type TimelineView = {
  /** The household's current month, YYYY-MM. */
  month: string;
  /** Null when this month has no days in the payload at all. */
  monthView: MonthView | null;
  rows: LedgerRow[];
  /** Row to scroll to on open: today, else the projection divider, else none. */
  scrollToRow: number | null;
  /** Tier for the header's payday-anchored dip. */
  dipStatus: DipStatus;
  /** Tier for the month's own low, the strip figure. Null when no month data. */
  lowestStatus: DipStatus | null;
};

export function buildTimelineView(data: TimelineOk, today: string): TimelineView {
  const month = today.slice(0, 7);
  const monthView = buildMonthView(
    data.days,
    data.unbalancedDays,
    data.openingBalance,
    data.balancesStartDate,
    month
  );

  const dipDate = data.dip?.date ?? null;

  // This month: the same days the web page shows, plus the dip's own day.
  const inMonth = data.days.filter(
    (day) =>
      day.date.slice(0, 7) === month && (day.entries.length > 0 || day.date === dipDate)
  );

  // The run-on: later months, up to the next pay, never past the horizon.
  const horizon = data.horizonEndMonth ?? null;
  const payday = data.nextIncomeDate;
  // NO SEPARATE "is the pay next month?" TEST. The `> month` below already
  // empties the run-on whenever the pay falls inside this month, and a second
  // condition restating that was provably redundant — inverting it changed no
  // behaviour, which is how it was found. The null check stays because it
  // guards a comparison against null, not because the result would differ.
  const runOn =
    payday === null
      ? []
      : data.days.filter(
          (day) =>
            day.date.slice(0, 7) > month &&
            day.date <= payday &&
            (horizon === null || day.date.slice(0, 7) <= horizon) &&
            (day.entries.length > 0 || day.date === dipDate)
        );
  const runOnDates = new Set(runOn.map((day) => day.date));

  const rows: LedgerRow[] = [];

  for (const day of monthView?.unbalancedDays ?? []) {
    rows.push({ kind: 'unbalanced', day });
  }
  if (monthView?.balancesBeginNote && rows.length > 0) {
    // The real date balances begin on. The web page passes the 1st of the
    // month here, which is the one date this note is never about — see the
    // handoff. Not mirrored.
    rows.push({ kind: 'balancesBegin', date: data.balancesStartDate });
  }

  let projectionPlaced = false;
  let runOnPlaced = false;
  for (const day of [...inMonth, ...runOn]) {
    if (!projectionPlaced && day.date > today) {
      rows.push({ kind: 'projection' });
      projectionPlaced = true;
    }
    if (!runOnPlaced && payday !== null && runOnDates.has(day.date)) {
      rows.push({ kind: 'runOn', payday });
      runOnPlaced = true;
    }
    rows.push({ kind: 'day', day, isToday: day.date === today });
  }

  const todayRow = rows.findIndex((row) => row.kind === 'day' && row.isToday);
  const projectionRow = rows.findIndex((row) => row.kind === 'projection');
  const scrollToRow = todayRow >= 0 ? todayRow : projectionRow >= 0 ? projectionRow : null;

  return {
    month,
    monthView,
    rows,
    scrollToRow,
    dipStatus: classifyDip(data.dip),
    lowestStatus: monthView ? classifyDip(monthView.lowest) : null,
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────
//
// NOON UTC, FORMATTED IN UTC — the review screen's fix, for its reason. The
// web app's `new Date(iso + 'T00:00:00')` builds midnight in the DEVICE's zone
// and formats in the device's zone; on a phone west of the household, midnight
// local is the previous day, and every row would be labelled a day early.
// Noon can't cross a date boundary in any zone, and timeZone: 'UTC' keeps the
// formatter from applying another offset on top.

function intl(locale: Locale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    ...options,
    timeZone: 'UTC',
  });
}

function noonUTC(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** "Tue, Sep 30" / « mar. 30 sept. » — a ledger row's heading. */
export function formatDayShort(iso: string, locale: Locale): string {
  return intl(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(noonUTC(iso));
}

/** "30 September" / « 30 septembre » — the dip and payday in prose. */
export function formatDayLong(iso: string, locale: Locale): string {
  return intl(locale, { day: 'numeric', month: 'long' }).format(noonUTC(iso));
}

// ── Entry amounts ───────────────────────────────────────────────────────────

/** How one entry's amount reads. Tones map to colours in the screen. */
export type AmountTone = 'income' | 'draw' | 'plain';

/**
 * The web app's formatSignedAmount rule, plus its draw case.
 *
 * Every row here is on the chequing account, so a NEGATIVE transfer can only
 * be a debt draw's chequing-side row (@phare/core's TimelineTx documents the
 * storage): real cash in. It reads with a "+" like income but in amber, never
 * green — borrowed money must not look like a paycheque at a glance.
 */
export function entryAmount(
  entry: Pick<TimelineEntry, 'amount' | 'type'>,
  locale: Locale
): { text: string; tone: AmountTone } {
  const isDraw = entry.type === 'transfer' && entry.amount < 0;
  if (isDraw) {
    return { text: `+${formatCADLocale(Math.abs(entry.amount), locale)}`, tone: 'draw' };
  }
  if (entry.type === 'income') {
    return { text: `+${formatCADLocale(entry.amount, locale)}`, tone: 'income' };
  }
  return { text: formatCADLocale(Math.abs(entry.amount), locale), tone: 'plain' };
}

// ---------------------------------------------------------------------------
// Onboarding decisions shared by the web upload page and the mobile
// onboarding flow. Pure: the screens own state, fetching and streaming; these
// own the choices, so both platforms make the same ones.
// ---------------------------------------------------------------------------

/**
 * Whether the plan screen should offer the way out to the dashboard.
 *
 * THE RULE: show it whenever the plan screen is up, EXCEPT when the screen is
 * already asking the user for something. There are exactly two such moments,
 * and both own the screen while they last:
 *
 *   - planSaveStatus === 'error' — the save failed and a Retry is sitting
 *     there. Leaving now abandons a plan that is genuinely not saved.
 *   - the replace-confirmation dialog is open — the server came back with
 *     needsConfirmation, NOTHING has been written, and the user is being asked
 *     to approve replacing existing data. A competing primary action here
 *     would let them walk away believing they were done.
 *
 * Everything else shows the button. In particular:
 *
 *   NOT GATED ON reviewStreaming. A letter still being written does not make
 *   the dashboard unreachable, and the plan itself is already fully rendered
 *   above it.
 *
 *   NOT GATED ON planSaveStatus === 'saved'. An earlier version of this
 *   required it, on the reasoning that navigating away mid-save could abandon
 *   an in-flight request. That was rejected deliberately: the "Saving your
 *   plan…" line renders directly beside the button while a save is in flight,
 *   so the user can see the state they are in, and the far more common failure
 *   was a user stranded on a finished plan screen with no visible way forward.
 *   A stranded user is certain; the mid-save exit is rare and self-signposted.
 *
 * A FAILED REVIEW STILL SHOWS THE BUTTON, and now for a simpler reason than
 * before — the review does not appear in this predicate at all. There is no
 * path by which a letter failing to generate can hide the way out.
 */

export type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function canGoToDashboard(state: {
  planSaveStatus: PlanSaveStatus;
  /** True while the needsConfirmation replace dialog is on screen. */
  replaceConfirmationOpen: boolean;
}): boolean {
  return state.planSaveStatus !== 'error' && !state.replaceConfirmationOpen;
}

/**
 * 'YYYY-MM-DD' → a date a person reads, in their own locale.
 *
 * TWO INDEPENDENT GUARDS against the off-by-one-day slip, and this is not
 * belt-and-braces by accident — mutation testing showed each one alone is
 * sufficient, so removing either in isolation changes nothing observable:
 *
 *   - `timeZone: 'UTC'` on the formatter, so the ambient server/browser zone
 *     cannot shift the rendered day.
 *   - parsing at NOON rather than midnight, so even without that option there
 *     are twelve hours of slack either side.
 *
 * Without BOTH, `new Date('2026-09-01')` is midnight UTC and formats as August
 * 31st in every Canadian zone: the household would be told its allowance
 * refills the day before it actually does. Do not "simplify" by deleting one
 * on the grounds that the tests still pass — they pass because the other is
 * still there.
 *
 * Returns '' for a missing or malformed value so the caller renders a message
 * with a blank date rather than "Invalid Date".
 */
export function formatResetDate(resetsOn: string | undefined, locale: string): string {
  if (!resetsOn || !/^\d{4}-\d{2}-\d{2}$/.test(resetsOn)) return '';
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${resetsOn}T12:00:00Z`));
}

/**
 * Which message an onboarding route's error `code` maps to.
 *
 * Server error bodies carry a machine-readable `code`; the `error` prose is a
 * last-resort fallback. Mapping the code to a translated message is what stops
 * an English sentence from the API surfacing inside a French screen — the
 * routes compose their prose server-side with no notion of the caller's
 * locale.
 *
 * Returns null for an unrecognised code (or none). The caller must then show
 * whatever the server said, and only fall back to generic copy when it said
 * nothing — never swallow a real reason behind generic copy.
 *
 * Each platform maps the kind to its own catalogue key with literal keys, so
 * the i18n key tests on both sides can still see every one.
 */
export type OnboardingErrorKind =
  | 'payloadTooLarge'
  | 'aiUnavailable'
  | 'rateLimited'
  | 'notAuthenticated'
  /** The reset date is the point of this message — pass `resetsOn` through. */
  | 'onboardingQuotaExhausted'
  | 'planFailed';

export function onboardingErrorKind(code: string | undefined): OnboardingErrorKind | null {
  switch (code) {
    case 'PAYLOAD_TOO_LARGE': return 'payloadTooLarge';
    case 'AI_UNAVAILABLE':    return 'aiUnavailable';
    case 'RATE_LIMITED':      return 'rateLimited';
    case 'NOT_AUTHENTICATED': return 'notAuthenticated';
    case 'ONBOARDING_QUOTA_EXHAUSTED': return 'onboardingQuotaExhausted';
    case 'INVALID_JSON':
    case 'UNKNOWN_PLAN_SOURCE':
    case 'PLAN_FAILED':       return 'planFailed';
    default: return null;
  }
}

/**
 * What to do with a 2xx /api/save-plan response.
 *
 *   - needsConfirmation: NOTHING was written. The server wants approval to
 *     replace existing data. Show the counts; do not anchor.
 *   - needsPayDate: saved, and some income rows still need a real pay date.
 *   - done: saved, nothing further to ask.
 *
 * Both saved outcomes carry the notices the plan screen shows. A body that
 * failed to parse (null) is a save with no notices — the same reading the web
 * page has always given it.
 */
export type AfterSaveOutcome<Item, Counts> =
  | { kind: 'needsConfirmation'; counts: Counts }
  | {
      kind: 'needsPayDate' | 'done';
      needsPayDate: Item[];
      unmatchedMembers: { label: string; attemptedMember: string }[];
      householdMembers: { id: string; name: string }[];
    };

export function afterSaveOutcome<Item, Counts>(
  data: {
    needsConfirmation?: unknown;
    counts?: Counts;
    needsPayDate?: Item[];
    unmatchedMembers?: { label: string; attemptedMember: string }[];
    householdMembers?: { id: string; name: string }[];
  } | null | undefined
): AfterSaveOutcome<Item, Counts> {
  if (data?.needsConfirmation) {
    return { kind: 'needsConfirmation', counts: data.counts as Counts };
  }
  const needsPayDate = data?.needsPayDate ?? [];
  return {
    kind: needsPayDate.length > 0 ? 'needsPayDate' : 'done',
    needsPayDate,
    unmatchedMembers: data?.unmatchedMembers ?? [],
    householdMembers: data?.householdMembers ?? [],
  };
}

/**
 * The chequing opening balance to anchor after a successful save, or null for
 * "do not anchor".
 *
 * Blank means "not now" — skipped on purpose, and the dashboard's anchor
 * prompt covers it. The caller calls this only AFTER the plan save succeeded:
 * save-plan is what guarantees a chequing account exists.
 *
 * `raw` is read with Number(), which does not understand a decimal comma. The
 * mobile flow therefore normalises its input through parseAmountInput before
 * it gets here and refuses, visibly, anything that does not parse — so this
 * returning null for "1234,56" can only happen on a path that already showed
 * an error.
 */
export function openingAnchorValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return value;
}

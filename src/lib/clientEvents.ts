// ---------------------------------------------------------------------------
// Client-emittable funnel events — the allowlist, the validator, the emitter.
//
// WHY THIS EXISTS AT ALL. Every event in this app until now was written
// server-side from a route the client was already calling. The onboarding
// funnel cannot work that way: five of its steps (the dashboard empty state,
// the /upload page load, the file-vs-manual fork, the manual form, the
// accounts step) make NO server call whatsoever. There is no existing request
// to piggyback on, so there has to be a channel — POST /api/events.
//
// ---------------------------------------------------------------------------
// THE SECURITY PROPERTY, which is the whole reason this file is not three
// lines inside the route.
//
// `events.event_type` is unconstrained `text` — no CHECK, no enum, no FK
// (20260620000000_event_log.sql). And two live systems DERIVE SPEND LIMITS by
// counting rows in that table by event_type:
//
//   onboardingQuotaServer.readOnboardingQuota()   counts 'onboarding_plan_generated'
//                                                 and 'onboarding_review_generated'
//   regenerationQuotaServer.readQuota()           counts 'review_regenerated'
//
// An endpoint that let a client name its own event_type would let a client
// write rows into the same table those counters read. The counters both fail
// CLOSED, so the immediate effect is self-denial rather than free Anthropic
// spend — a household could lock itself out of onboarding — but "the exploit
// only breaks your own account" is not a security argument, and the failure
// mode inverts the moment anyone adds a counter that fails open.
//
// So: an ALLOWLIST, not a denylist. A type that is not an own-property of
// CLIENT_EVENT_ALLOWLIST is refused, full stop. The three quota types are
// excluded by construction because they were never added — and
// assertNoQuotaEvents() below turns "were never added" from a fact someone has
// to remember into one the module refuses to load without.
//
// ---------------------------------------------------------------------------
// NO PII, STRUCTURALLY RATHER THAN BY REVIEW.
//
// Metadata values are not validated strings — they are members of a
// compile-time enum declared right here. There is no code path by which any
// caller-supplied string reaches the database: an unrecognised key is refused,
// and a recognised key whose value is not in its enum is refused. A future
// event cannot leak a file name, a category label, a member name or an amount
// without someone first adding a free-string field to this file, which is a
// visible act in review rather than an accident at a call site.
// ---------------------------------------------------------------------------

import { PLAN_GENERATION_EVENT, REVIEW_GENERATION_EVENT } from '@/lib/onboardingQuota';
import { REGENERATION_EVENT } from '@/lib/regenerationQuota';

/**
 * The event types that are ALSO quota counters. Imported from their real
 * definitions rather than re-typed as literals, so renaming a quota event
 * cannot silently unhook this guard from the thing it guards.
 */
export const QUOTA_EVENT_TYPES = [
  PLAN_GENERATION_EVENT,
  REVIEW_GENERATION_EVENT,
  REGENERATION_EVENT,
] as const;

/**
 * Event type → the metadata keys it accepts, each with its closed set of
 * permitted values. An empty object means "this event takes no metadata", and
 * any metadata at all is then a rejection.
 *
 * Phase 2 ships exactly two. Events #3–#6 from the funnel proposal
 * (onboarding_step_reached, onboarding_upload_rejected,
 * onboarding_plausibility_resolved, onboarding_template_downloaded) are
 * deliberately NOT here — they are conditional on what these two report.
 */
export const CLIENT_EVENT_ALLOWLIST = {
  /** The /upload entry screen rendered. Answers "did they reach it at all". */
  onboarding_entry_viewed: {},

  /** They picked a lane: dropped/selected a file, or opened the manual form. */
  onboarding_path_chosen: {
    path: ['template', 'manual'],
  },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type ClientEventType = keyof typeof CLIENT_EVENT_ALLOWLIST;

/**
 * Refuses an allowlist that contains a quota counter's event type.
 *
 * Called at module load with the real allowlist, so a mistake is a loud crash
 * at import rather than a quiet corruption of a billing counter discovered
 * later from the invoice. Exported and parameterised so the guard itself is
 * testable — a test can hand it a deliberately poisoned allowlist without
 * having to defeat a `const`.
 */
export function assertNoQuotaEvents(allowlist: Record<string, unknown>): void {
  for (const forbidden of QUOTA_EVENT_TYPES) {
    if (Object.prototype.hasOwnProperty.call(allowlist, forbidden)) {
      throw new Error(
        `[clientEvents] '${forbidden}' is a QUOTA COUNTER, not a funnel event. ` +
        'Allowing a client to write it would let a household corrupt its own ' +
        'Anthropic spend limit. Remove it from CLIENT_EVENT_ALLOWLIST; if you ' +
        'genuinely need a client-visible signal for that step, add a NEW ' +
        'event type with a different name.'
      );
    }
  }
}

assertNoQuotaEvents(CLIENT_EVENT_ALLOWLIST);

export type ClientEventRejection =
  | 'malformed_body'
  | 'unknown_event_type'
  | 'malformed_metadata'
  | 'unknown_metadata_key'
  | 'invalid_metadata_value';

export type ClientEventValidation =
  | { ok: true; type: ClientEventType; metadata: Record<string, string> | null }
  | { ok: false; reason: ClientEventRejection };

/**
 * Validates a POST /api/events body against the allowlist.
 *
 * Pure and transport-free on purpose: the route does auth and persistence, and
 * this does the part that has to be right. Every rejection is a distinct
 * reason so a 400 can say something true without echoing the caller's own
 * string back at them.
 */
export function validateClientEvent(body: unknown): ClientEventValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'malformed_body' };
  }

  const { type, metadata } = body as { type?: unknown; metadata?: unknown };

  if (typeof type !== 'string') return { ok: false, reason: 'malformed_body' };

  // hasOwnProperty, not `in` and not a bare property read: `in` would accept
  // 'toString' and '__proto__' and hand back a function or Object.prototype as
  // if it were a spec.
  if (!Object.prototype.hasOwnProperty.call(CLIENT_EVENT_ALLOWLIST, type)) {
    return { ok: false, reason: 'unknown_event_type' };
  }

  const spec = CLIENT_EVENT_ALLOWLIST[type as ClientEventType] as Record<string, readonly string[]>;

  if (metadata === undefined || metadata === null) {
    return { ok: true, type: type as ClientEventType, metadata: null };
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, reason: 'malformed_metadata' };
  }

  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: true, type: type as ClientEventType, metadata: null };
  }

  const clean: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) {
      return { ok: false, reason: 'unknown_metadata_key' };
    }
    // The value must be a member of the declared enum. A string that merely
    // looks reasonable is not enough — this is the check that makes "no PII"
    // a property of the code rather than a promise about call sites.
    if (typeof value !== 'string' || !spec[key].includes(value)) {
      return { ok: false, reason: 'invalid_metadata_value' };
    }
    clean[key] = value;
  }

  return { ok: true, type: type as ClientEventType, metadata: clean };
}

/**
 * Fire-and-forget emission from the browser. Returns void, never a promise —
 * there is deliberately nothing for a caller to await, so no call site can
 * accidentally put telemetry on a user's critical path.
 *
 * `keepalive` so an emission survives the navigation that immediately follows
 * it (clicking through to the manual form, for instance). Every failure is
 * swallowed: a funnel event must never surface an error to someone trying to
 * onboard.
 *
 * The response is ignored entirely, including its status. A 400 here means a
 * developer wired a call site wrong, and it is visible in the network tab and
 * the server log; making the user's browser react to it would be worse than
 * useless.
 */
export function emitClientEvent(
  type: ClientEventType,
  metadata?: Record<string, string>
): void {
  if (typeof window === 'undefined') return;
  try {
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata ? { type, metadata } : { type }),
      keepalive: true,
    }).catch(() => { /* telemetry must never break onboarding */ });
  } catch {
    /* same, for a synchronous throw out of fetch itself */
  }
}

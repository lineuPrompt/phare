import { describe, it, expect } from 'vitest';
import {
  CLIENT_EVENT_ALLOWLIST,
  QUOTA_EVENT_TYPES,
  assertNoQuotaEvents,
  validateClientEvent,
} from '@/lib/clientEvents';
import { PLAN_GENERATION_EVENT, REVIEW_GENERATION_EVENT } from '@/lib/onboardingQuota';
import { REGENERATION_EVENT } from '@/lib/regenerationQuota';

// ---------------------------------------------------------------------------
// The allowlist is a security boundary, not a config object: events.event_type
// is unconstrained text and two spend-limit counters read that table by type.
// These tests exist to fail if anyone loosens it.
// ---------------------------------------------------------------------------

describe('QUOTA_EVENT_TYPES — bound to the real constants', () => {
  it('tracks the actual quota event names, not stale copies of them', () => {
    // If a quota event is ever renamed, this fails and points at the guard
    // that would otherwise have quietly stopped guarding anything.
    expect(QUOTA_EVENT_TYPES).toContain(PLAN_GENERATION_EVENT);
    expect(QUOTA_EVENT_TYPES).toContain(REVIEW_GENERATION_EVENT);
    expect(QUOTA_EVENT_TYPES).toContain(REGENERATION_EVENT);
    expect(QUOTA_EVENT_TYPES).toHaveLength(3);
  });

  it('names the three types the funnel must never be able to write', () => {
    expect([...QUOTA_EVENT_TYPES].sort()).toEqual([
      'onboarding_plan_generated',
      'onboarding_review_generated',
      'review_regenerated',
    ]);
  });
});

describe('assertNoQuotaEvents', () => {
  it('accepts the real allowlist', () => {
    expect(() => assertNoQuotaEvents(CLIENT_EVENT_ALLOWLIST)).not.toThrow();
  });

  // Parameterised over the real constants rather than three hand-written
  // literals — adding a fourth quota event covers itself.
  for (const forbidden of QUOTA_EVENT_TYPES) {
    it(`refuses an allowlist containing '${forbidden}'`, () => {
      expect(() =>
        assertNoQuotaEvents({ onboarding_entry_viewed: {}, [forbidden]: {} })
      ).toThrow(new RegExp(forbidden));
    });
  }

  it('explains why, not just that', () => {
    expect(() => assertNoQuotaEvents({ [REGENERATION_EVENT]: {} }))
      .toThrow(/QUOTA COUNTER/);
  });
});

describe('CLIENT_EVENT_ALLOWLIST', () => {
  it('contains no quota event type', () => {
    for (const forbidden of QUOTA_EVENT_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(CLIENT_EVENT_ALLOWLIST, forbidden)).toBe(false);
    }
  });

  it('ships exactly the two Phase 2 events — #3-#6 are held back on purpose', () => {
    expect(Object.keys(CLIENT_EVENT_ALLOWLIST).sort()).toEqual([
      'onboarding_entry_viewed',
      'onboarding_path_chosen',
    ]);
  });

  it('declares every metadata value as a closed set, never a free string', () => {
    for (const spec of Object.values(CLIENT_EVENT_ALLOWLIST)) {
      for (const permitted of Object.values(spec as Record<string, readonly string[]>)) {
        expect(Array.isArray(permitted)).toBe(true);
        expect(permitted.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('validateClientEvent — accepts', () => {
  it('an allowlisted event with no metadata', () => {
    expect(validateClientEvent({ type: 'onboarding_entry_viewed' }))
      .toEqual({ ok: true, type: 'onboarding_entry_viewed', metadata: null });
  });

  it('an explicit null metadata', () => {
    expect(validateClientEvent({ type: 'onboarding_entry_viewed', metadata: null }))
      .toEqual({ ok: true, type: 'onboarding_entry_viewed', metadata: null });
  });

  it('an empty metadata object, normalised to null', () => {
    // jsonb null rather than {} so the column reads the same whichever shape
    // the caller happened to send.
    expect(validateClientEvent({ type: 'onboarding_entry_viewed', metadata: {} }))
      .toEqual({ ok: true, type: 'onboarding_entry_viewed', metadata: null });
  });

  it.each(['template', 'manual'])('path=%s', (path) => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata: { path } }))
      .toEqual({ ok: true, type: 'onboarding_path_chosen', metadata: { path } });
  });
});

describe('validateClientEvent — refuses quota event types', () => {
  for (const forbidden of QUOTA_EVENT_TYPES) {
    it(`refuses '${forbidden}'`, () => {
      expect(validateClientEvent({ type: forbidden }))
        .toEqual({ ok: false, reason: 'unknown_event_type' });
    });

    it(`refuses '${forbidden}' even with a plausible month payload`, () => {
      // The shape reserveOnboardingGeneration actually writes. If this were
      // ever accepted, a household could forge quota rows against itself.
      expect(validateClientEvent({ type: forbidden, metadata: { month: '2026-09' } }))
        .toEqual({ ok: false, reason: 'unknown_event_type' });
    });
  }
});

describe('validateClientEvent — refuses everything else', () => {
  it.each([
    ['a server-only event type', { type: 'completed_onboarding' }],
    ['an invented type', { type: 'anything_at_all' }],
    ['an empty type', { type: '' }],
    ['a held-back Phase 3 type', { type: 'onboarding_step_reached' }],
  ])('%s', (_label, body) => {
    expect(validateClientEvent(body)).toEqual({ ok: false, reason: 'unknown_event_type' });
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'refuses the inherited property %s rather than reading it off the prototype',
    (type) => {
      expect(validateClientEvent({ type })).toEqual({ ok: false, reason: 'unknown_event_type' });
    }
  );

  it.each([
    ['null', null],
    ['a string', 'onboarding_entry_viewed'],
    ['an array', ['onboarding_entry_viewed']],
    ['an object with no type', {}],
    ['a non-string type', { type: 42 }],
  ])('refuses %s as a body', (_label, body) => {
    expect(validateClientEvent(body)).toEqual({ ok: false, reason: 'malformed_body' });
  });

  it('refuses metadata on an event declared to take none', () => {
    expect(validateClientEvent({ type: 'onboarding_entry_viewed', metadata: { path: 'manual' } }))
      .toEqual({ ok: false, reason: 'unknown_metadata_key' });
  });

  it('refuses an undeclared metadata key', () => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata: { path: 'manual', extra: 'x' } }))
      .toEqual({ ok: false, reason: 'unknown_metadata_key' });
  });

  it('refuses a value outside the declared set', () => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata: { path: 'bank_statement' } }))
      .toEqual({ ok: false, reason: 'invalid_metadata_value' });
  });

  // The no-PII property, stated as tests. None of these can reach the column,
  // because `path` accepts two literals and nothing else.
  it.each([
    ['an email',        'someone@example.com'],
    ['a file name',     'Budget familial 2026.xlsx'],
    ['a member name',   'Marie-Claude'],
    ['an amount',       '4820.55'],
    ['a category',      'Épicerie'],
  ])('refuses %s smuggled into a declared key', (_label, value) => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata: { path: value } }))
      .toEqual({ ok: false, reason: 'invalid_metadata_value' });
  });

  it.each([
    ['a number',  { path: 1 }],
    ['a boolean', { path: true }],
    ['null',      { path: null }],
    ['an object', { path: { toString: () => 'manual' } }],
    ['an array',  { path: ['manual'] }],
  ])('refuses %s as a metadata value', (_label, metadata) => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata }))
      .toEqual({ ok: false, reason: 'invalid_metadata_value' });
  });

  it.each([
    ['a string', 'path=manual'],
    ['an array', ['manual']],
  ])('refuses %s as metadata', (_label, metadata) => {
    expect(validateClientEvent({ type: 'onboarding_path_chosen', metadata }))
      .toEqual({ ok: false, reason: 'malformed_metadata' });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isInternalHousehold } from '@/lib/internalAccess';

// This function is the whole boundary for /reconcile — the page, GET
// /api/reconcile and GET /api/reconcile/months all reduce to it. The cases
// that matter most are the ones where it must say NO, because every one of
// them is a configuration state that arises by accident: the variable never
// set in a new environment, set to an empty string, set to a list of commas.
// A gate that opens on any of those is worse than no gate, since it looks
// like it is working.

const VAR = 'PHARE_INTERNAL_HOUSEHOLD_IDS';
const MINE = '11111111-2222-3333-4444-555555555555';
const THEIRS = '99999999-8888-7777-6666-555555555555';

let original: string | undefined;

beforeEach(() => { original = process.env[VAR]; });
afterEach(() => {
  if (original === undefined) delete process.env[VAR];
  else process.env[VAR] = original;
});

describe('isInternalHousehold — fails closed', () => {
  it('says no to everyone when the variable is unset', () => {
    delete process.env[VAR];
    expect(isInternalHousehold(MINE)).toBe(false);
  });

  it('says no to everyone when the variable is empty or only whitespace', () => {
    for (const value of ['', '   ', '\n']) {
      process.env[VAR] = value;
      expect(isInternalHousehold(MINE)).toBe(false);
    }
  });

  it('says no when the list is nothing but separators', () => {
    // ',,,' splits into empty strings. Without the filter these would become
    // allowlist entries that an empty household id could match.
    process.env[VAR] = ',,,';
    expect(isInternalHousehold(MINE)).toBe(false);
    expect(isInternalHousehold('')).toBe(false);
  });

  it('says no for a missing household id even when the list is populated', () => {
    process.env[VAR] = MINE;
    expect(isInternalHousehold(null)).toBe(false);
    expect(isInternalHousehold(undefined)).toBe(false);
    expect(isInternalHousehold('')).toBe(false);
  });

  it('says no to a household that is not on the list', () => {
    process.env[VAR] = MINE;
    expect(isInternalHousehold(THEIRS)).toBe(false);
  });

  it('matches whole entries, not substrings', () => {
    // A prefix/suffix of an allowed id must not get in — the failure mode of
    // testing the raw string with .includes() instead of the parsed list.
    process.env[VAR] = MINE;
    expect(isInternalHousehold(MINE.slice(0, 8))).toBe(false);
    expect(isInternalHousehold(MINE + 'a')).toBe(false);
  });
});

describe('isInternalHousehold — admits the allowlist', () => {
  it('admits an exact match', () => {
    process.env[VAR] = MINE;
    expect(isInternalHousehold(MINE)).toBe(true);
  });

  it('admits any entry in a multi-value list, spaces and all', () => {
    process.env[VAR] = ` ${THEIRS} , ${MINE} `;
    expect(isInternalHousehold(MINE)).toBe(true);
    expect(isInternalHousehold(THEIRS)).toBe(true);
  });

  it('ignores case on both sides — a UUID pasted from a console is often upper', () => {
    process.env[VAR] = MINE.toUpperCase();
    expect(isInternalHousehold(MINE)).toBe(true);
    expect(isInternalHousehold(MINE.toUpperCase())).toBe(true);
  });

  it('reads the environment at call time, not at import', () => {
    // A value captured at module scope would freeze whatever the environment
    // held when the lambda cold-started.
    delete process.env[VAR];
    expect(isInternalHousehold(MINE)).toBe(false);
    process.env[VAR] = MINE;
    expect(isInternalHousehold(MINE)).toBe(true);
  });
});

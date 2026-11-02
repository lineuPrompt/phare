import { describe, it, expect } from 'vitest';
import { DEFAULT_HOUSEHOLD_TIMEZONE } from '@phare/core';
import { getHouseholdTimezone } from '../householdTimezone';

// A failed read used to come back as Toronto time, as if the household had
// chosen it (docs/tickets/household-timezone-read-error-falls-back.md).

function client(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => result,
  };
  return { from: () => chain } as unknown as Parameters<typeof getHouseholdTimezone>[0];
}

describe('getHouseholdTimezone', () => {
  it('returns the household’s own timezone', async () => {
    expect(await getHouseholdTimezone(client({ data: { timezone: 'America/Vancouver' }, error: null }), 'hh')).toBe('America/Vancouver');
  });

  it('a failed read throws with the reason — never Toronto in disguise', async () => {
    await expect(getHouseholdTimezone(client({ data: null, error: { message: 'connection reset' } }), 'hh'))
      .rejects.toThrow("could not read the household's timezone: connection reset");
  });

  it('a row read without a value still falls back to the default (the column is NOT NULL; belt and braces)', async () => {
    expect(await getHouseholdTimezone(client({ data: { timezone: null }, error: null }), 'hh')).toBe(DEFAULT_HOUSEHOLD_TIMEZONE);
  });
});

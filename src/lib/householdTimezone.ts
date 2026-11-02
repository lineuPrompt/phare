import type { createClient } from './supabase-server';
import { DEFAULT_HOUSEHOLD_TIMEZONE } from '@phare/core';

/**
 * The household's IANA timezone — the input to businessToday()/
 * businessMonth() (dateHelpers.ts). Falls back to the default only if the
 * row is somehow missing it (should never happen: the column is NOT NULL
 * with a default), never to the server's or caller's local clock.
 *
 * A FAILED READ THROWS (2026-11-02). It used to return the default as if the
 * household had chosen it, so a Vancouver household's "today" could quietly
 * become Toronto's; each caller's own error path now reports it
 * (docs/tickets/household-timezone-read-error-falls-back.md).
 */
export async function getHouseholdTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('households')
    .select('timezone')
    .eq('id', householdId)
    .single();
  if (error) throw new Error(`could not read the household's timezone: ${error.message}`);
  return (data?.timezone as string | undefined) ?? DEFAULT_HOUSEHOLD_TIMEZONE;
}

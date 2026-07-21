import type { createClient } from './supabase-server';
import { DEFAULT_HOUSEHOLD_TIMEZONE } from './dateHelpers';

/**
 * The household's IANA timezone — the input to businessToday()/
 * businessMonth() (dateHelpers.ts). Falls back to the default only if the
 * row is somehow missing it (should never happen: the column is NOT NULL
 * with a default), never to the server's or caller's local clock.
 */
export async function getHouseholdTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string
): Promise<string> {
  const { data } = await supabase
    .from('households')
    .select('timezone')
    .eq('id', householdId)
    .single();
  return (data?.timezone as string | undefined) ?? DEFAULT_HOUSEHOLD_TIMEZONE;
}

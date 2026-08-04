import { entitlementFor, type Entitlement, type EntitlementInput } from '@/lib/entitlement';

// ---------------------------------------------------------------------------
// Reads the household's billing columns and returns the derived entitlement.
//
// Exists so every gated route asks the same question with the same columns. A
// route that hand-rolled its own select could omit comp_until and silently
// paywall a comped family, or omit current_period_end and grant access to a
// lapsed one — both are single-word mistakes with billing consequences, and
// neither would fail a test that only covered the route it happened to be in.
//
// FAILS CLOSED. If the household row cannot be read, the caller is treated as
// free. The alternative — defaulting to Pro on a database hiccup — gives away
// the product on exactly the errors nobody notices.
// ---------------------------------------------------------------------------

// Minimal structural type, same approach as EventClient / AdminLike: the real
// Supabase builder types are too elaborate to restate and a hand-written
// approximation fails to accept the genuine article.
export interface HouseholdReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/** The exact column list entitlement depends on. One place, so it cannot drift. */
export const ENTITLEMENT_COLUMNS = 'subscription_status, subscription_current_period_end, comp_until';

export async function loadEntitlement(
  supabase: HouseholdReader,
  householdId: string,
  now?: Date
): Promise<Entitlement> {
  try {
    const { data, error } = await supabase
      .from('households')
      .select(ENTITLEMENT_COLUMNS)
      .eq('id', householdId)
      .single();

    if (error || !data) {
      console.error('Entitlement — could not read household billing state, treating as free:', error);
      return { isPro: false, reason: 'none' };
    }

    return entitlementFor(data as EntitlementInput, now);
  } catch (err) {
    console.error('Entitlement — household read threw, treating as free:', err);
    return { isPro: false, reason: 'none' };
  }
}

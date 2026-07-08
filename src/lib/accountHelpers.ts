/**
 * Chequing-account provisioning.
 *
 * Every household needs exactly one chequing account. Normally it's created
 * once, atomically, by the handle_new_user signup trigger (households +
 * users + household_members + chequing, all in one INSERT sequence — see
 * supabase/migrations/20260618000000_initial_schema.sql). But that trigger
 * only ever fires at signup. Any code path that can delete the chequing
 * account (the household reset script, and nothing else today) leaves a
 * household the app has no way to recover from unless something else can
 * (re)create it on demand.
 *
 * ensureChequingAccount is that something else — the one place outside the
 * signup trigger allowed to create a chequing account, using the exact same
 * defaults the trigger uses. Callers that need a household's chequing
 * account should call this instead of assuming one already exists.
 */

// Minimal structural type — only the from() shape actually used here.
// Compatible with both the real Supabase client and test mocks.
export interface AccountClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/**
 * Returns the household's chequing account id, creating it (name
 * 'Chequing', type 'chequing' — the same two fields the signup trigger
 * sets, everything else left to its column defaults) if none exists yet.
 */
export async function ensureChequingAccount(
  supabase: AccountClient,
  householdId: string
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: selectError } = await supabase
    .from('accounts')
    .select('id')
    .eq('household_id', householdId)
    .eq('type', 'chequing')
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to look up chequing account: ${selectError.message}`);
  }
  if (existing) {
    return { id: existing.id, created: false };
  }

  const { data: created, error: insertError } = await supabase
    .from('accounts')
    .insert({ household_id: householdId, name: 'Chequing', type: 'chequing' })
    .select('id')
    .single();

  if (insertError || !created) {
    throw new Error(`Failed to create chequing account: ${insertError?.message ?? 'unknown error'}`);
  }
  return { id: created.id, created: true };
}

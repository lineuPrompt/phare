// ---------------------------------------------------------------------------
// The suite-wide stand-in for src/lib/conversationsClient.ts (installed by
// vitest.setup.ts).
//
// It forwards every query to whatever the test file made `createClient()`
// (supabase-server) return, so existing scripted reads and recorded writes
// keep working unchanged. And it records each table asked for through it in
// `conversationsClientTables`: a route test asserts 'conversations' is there,
// which fails the moment the route goes back to the session client.
// ---------------------------------------------------------------------------

/** Tables queried through conversationsClient() in this test, in order. */
export const conversationsClientTables: string[] = [];

export function resetConversationsClientDouble(): void {
  conversationsClientTables.length = 0;
}

export async function forwardingConversationsClient() {
  const { createClient } = await import('@/lib/supabase-server');
  const inner = (await createClient()) as unknown as { from: (table: string) => unknown };
  return {
    from(table: string) {
      conversationsClientTables.push(table);
      return inner.from(table);
    },
  };
}

// ---------------------------------------------------------------------------
// The suite-wide stand-in for src/lib/cardPlanWriter.ts (installed by
// vitest.setup.ts). Same shape as conversationsClientDouble.ts.
//
// It forwards every query to whatever the test file made `createClient()`
// (supabase-server) return, so existing fakes keep working unchanged. And it
// records each table asked for through it in `cardPlanWriterTables`: a route
// test asserts the plan tables are there, which fails the moment a write goes
// back to the session client.
// ---------------------------------------------------------------------------

/** Tables queried through cardPlanWriter() in this test, in order. */
export const cardPlanWriterTables: string[] = [];

export function resetCardPlanWriterDouble(): void {
  cardPlanWriterTables.length = 0;
}

export async function forwardingCardPlanWriter() {
  const { createClient } = await import('@/lib/supabase-server');
  const inner = (await createClient()) as unknown as { from: (table: string) => unknown };
  return {
    from(table: string) {
      cardPlanWriterTables.push(table);
      return inner.from(table);
    },
  };
}

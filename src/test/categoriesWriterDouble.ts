// ---------------------------------------------------------------------------
// The suite-wide stand-in for src/lib/categoriesWriter.ts (installed by
// vitest.setup.ts). Same shape as conversationsClientDouble.ts.
//
// It forwards every query to whatever the test file made `createClient()`
// (supabase-server) return, so existing scripted writes keep working
// unchanged. And it records each table asked for through it in
// `categoriesWriterTables`: a route test asserts 'categories' is there, which
// fails the moment the route goes back to the session client.
// ---------------------------------------------------------------------------

/** Tables queried through categoriesWriter() in this test, in order. */
export const categoriesWriterTables: string[] = [];

export function resetCategoriesWriterDouble(): void {
  categoriesWriterTables.length = 0;
}

export async function forwardingCategoriesWriter() {
  const { createClient } = await import('@/lib/supabase-server');
  const inner = (await createClient()) as unknown as { from: (table: string) => unknown };
  return {
    from(table: string) {
      categoriesWriterTables.push(table);
      return inner.from(table);
    },
  };
}

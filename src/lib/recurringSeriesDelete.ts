// ---------------------------------------------------------------------------
// "All from today on" — deleting a recurring entry's whole rule from the entry
// itself (Lineu, 2026-11-02: a mistaken recurring card bill had to be deleted
// entry by entry).
//
// It is the Recurring page's delete, reached from the entry: DELETE
// /api/recurring/[id] removes the rule and every row it still owns dated today
// or later. Past entries stay (history), and so do entries edited one by one
// (their recurring_item_id was cleared when they were edited, so the rule no
// longer owns them). A future entry is never in a closed card statement.
//
// A refusal is thrown with the server's own reason, never swallowed: the
// caller shows it beside the entry.
// ---------------------------------------------------------------------------

export function recurringSeriesPath(ruleId: string): string {
  return `/api/recurring/${encodeURIComponent(ruleId)}`;
}

export async function deleteRecurringFromToday(
  ruleId: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const res = await fetchImpl(recurringSeriesPath(ruleId), { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Delete failed (HTTP ${res.status})`);
  }
}

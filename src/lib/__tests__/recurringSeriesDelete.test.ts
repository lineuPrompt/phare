import { describe, it, expect, vi } from 'vitest';
import { deleteRecurringFromToday, recurringSeriesPath } from '../recurringSeriesDelete';

// "All from today on" from an entry (2026-11-02): the rule's own DELETE, and a
// refusal surfaces the server's reason instead of looking like success.

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('deleteRecurringFromToday', () => {
  it('sends DELETE to the rule, not to the entry', async () => {
    const fetchImpl = vi.fn(async () => answer(200, { deleted: true }));
    await deleteRecurringFromToday('rule-1', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/recurring/rule-1', { method: 'DELETE' });
  });

  it('throws the server’s own reason when the delete is refused', async () => {
    const fetchImpl = vi.fn(async () => answer(500, { error: 'Failed to remove the future occurrences: boom' }));
    await expect(deleteRecurringFromToday('rule-1', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('Failed to remove the future occurrences: boom');
  });

  it('a refusal with no JSON body still throws, with the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('gateway', { status: 502 }));
    await expect(deleteRecurringFromToday('rule-1', fetchImpl as unknown as typeof fetch))
      .rejects.toThrow('HTTP 502');
  });

  it('encodes the rule id into the path', () => {
    expect(recurringSeriesPath('a/b')).toBe('/api/recurring/a%2Fb');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { logEvent, isFirstEvent, isFirstReturnToday, EventClient } from '../eventLogger';
import { eventWriterBehaviour, recordedEvents } from '../../test/eventWriterDouble';

// ---------------------------------------------------------------------------
// Mock factory
//
// Builds a minimal structural mock of the Supabase client.
// The select chain is a Proxy that is thenable (awaitable) and supports
// .eq(), .gte(), .lt() chaining — mirroring the Supabase PostgrestBuilder API.
// ---------------------------------------------------------------------------

function makeChain(resolution: { count?: number | null; error?: { message: string } | null }) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (
          resolve: (v: typeof resolution) => unknown,
          reject?: (v: unknown) => unknown
        ) => Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) =>
          Promise.resolve(resolution).catch(reject);
      }
      // eq / gte / lt / lte and any other chainable methods
      return () => makeChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

function makeSupabase({
  count = 0,
  insertError = null,
  selectError = null,
  insertThrows = false,
  selectThrows = false,
}: {
  count?: number;
  insertError?: { message: string } | null;
  selectError?: { message: string } | null;
  insertThrows?: boolean;
  selectThrows?: boolean;
} = {}): EventClient {
  return {
    from: (_table: string) => ({
      insert: (_data: unknown) =>
        insertThrows
          ? Promise.reject(new Error('network error'))
          : Promise.resolve({ error: insertError }),
      select: (..._args: unknown[]) =>
        selectThrows
          ? (() => { throw new Error('select threw'); })()
          : makeChain({ count, error: selectError }),
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// logEvent — never throws, swallows all errors
// ---------------------------------------------------------------------------

describe('logEvent', () => {
  // logEvent writes through the service role (eventWriter.ts) since launch
  // plan 1.1; vitest.setup.ts installs a recording double, read here.

  it('writes the row through the event writer', async () => {
    await expect(logEvent('hh-1', 'u-1', 'returned')).resolves.toBeUndefined();
    expect(recordedEvents).toEqual([{ household_id: 'hh-1', user_id: 'u-1', event_type: 'returned', metadata: null }]);
  });

  it('swallows a rejected insert (network error) — never throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    eventWriterBehaviour.insertThrows = true;

    await expect(logEvent('hh-1', 'u-1', 'completed_onboarding')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('completed_onboarding'), expect.anything());
  });

  it('logs console.error when Supabase returns an error object — never throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    eventWriterBehaviour.insertError = { message: 'RLS violation' };

    await expect(logEvent('hh-1', 'u-1', 'created_first_expense')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('created_first_expense'), 'RLS violation');
  });

  it('passes metadata to the insert', async () => {
    await logEvent('hh-1', 'u-1', 'viewed_planner', { locale: 'en' });
    expect(recordedEvents[0]).toMatchObject({
      household_id: 'hh-1',
      user_id: 'u-1',
      event_type: 'viewed_planner',
      metadata: { locale: 'en' },
    });
  });

  it('sets metadata to null when not provided', async () => {
    await logEvent('hh-1', null, 'signup');
    expect(recordedEvents[0].metadata).toBeNull();
    expect(recordedEvents[0].user_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isFirstEvent — first-X guard logic
// ---------------------------------------------------------------------------

describe('isFirstEvent', () => {
  it('returns true when no event of this type has been logged (count = 0)', async () => {
    const supabase = makeSupabase({ count: 0 });
    expect(await isFirstEvent(supabase, 'hh-1', 'created_first_expense')).toBe(true);
  });

  it('returns false when the event has already been logged (count > 0)', async () => {
    const supabase = makeSupabase({ count: 1 });
    expect(await isFirstEvent(supabase, 'hh-1', 'created_first_expense')).toBe(false);
  });

  it('returns false (conservative) on Supabase error — never fires on DB error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase({ selectError: { message: 'connection timeout' } });
    expect(await isFirstEvent(supabase, 'hh-1', 'created_first_goal')).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns false (conservative) when select throws — never throws itself', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase({ selectThrows: true });
    await expect(
      isFirstEvent(supabase, 'hh-1', 'created_first_expense')
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('only fires when count is exactly 0 (boundary)', async () => {
    // count=0 → first event
    expect(await isFirstEvent(makeSupabase({ count: 0 }), 'hh', 'viewed_planner')).toBe(true);
    // count=1 → already logged
    expect(await isFirstEvent(makeSupabase({ count: 1 }), 'hh', 'viewed_planner')).toBe(false);
    // count=5 → already logged
    expect(await isFirstEvent(makeSupabase({ count: 5 }), 'hh', 'viewed_planner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFirstReturnToday — daily dedupe logic
// ---------------------------------------------------------------------------

describe('isFirstReturnToday', () => {
  it('returns true when no returned event today (count = 0)', async () => {
    const supabase = makeSupabase({ count: 0 });
    expect(await isFirstReturnToday(supabase, 'hh-1', 'u-1')).toBe(true);
  });

  it('returns false when a returned event already exists today (count = 1)', async () => {
    const supabase = makeSupabase({ count: 1 });
    expect(await isFirstReturnToday(supabase, 'hh-1', 'u-1')).toBe(false);
  });

  it('returns false (conservative) on Supabase error — prevents duplicate fires', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase({ selectError: { message: 'timeout' } });
    expect(await isFirstReturnToday(supabase, 'hh-1', 'u-1')).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns false (conservative) when select throws — never throws itself', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase({ selectThrows: true });
    await expect(
      isFirstReturnToday(supabase, 'hh-1', 'u-1')
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('queries with today UTC day boundaries (gte/lt)', async () => {
    // Verify the function correctly builds a [dayStart, dayEnd) window.
    // We do this by capturing the query arguments from the chain.
    const calls: { method: string; args: unknown[] }[] = [];

    function trackingChain(): unknown {
      const proxy: unknown = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === 'then') {
              return (resolve: (v: { count: number; error: null }) => unknown) =>
                Promise.resolve({ count: 0, error: null }).then(resolve);
            }
            return (...args: unknown[]) => {
              calls.push({ method: String(prop), args });
              return trackingChain();
            };
          },
        }
      );
      return proxy;
    }

    const supabase: EventClient = {
      from: () => ({
        select: () => trackingChain(),
        insert: () => Promise.resolve({ error: null }),
      }),
    };

    await isFirstReturnToday(supabase, 'hh-1', 'u-1');

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('gte');
    expect(methods).toContain('lt');

    // The gte call should be a full ISO timestamp for today's UTC midnight
    const gteCall = calls.find((c) => c.method === 'gte');
    const ltCall  = calls.find((c) => c.method === 'lt');
    expect(gteCall?.args[0]).toBe('created_at');
    expect(ltCall?.args[0]).toBe('created_at');

    // Both should be ISO timestamps
    expect(String(gteCall?.args[1])).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(String(ltCall?.args[1])).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);

    // lt timestamp should be exactly 1 day after gte
    const gteMs = new Date(String(gteCall?.args[1])).getTime();
    const ltMs  = new Date(String(ltCall?.args[1])).getTime();
    expect(ltMs - gteMs).toBe(86_400_000);
  });
});

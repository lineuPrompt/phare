import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTimelineLoader, timelinePath } from '../lib/timelineLoader';
import { gateView } from '../lib/authGate';

const APP_DIR = path.resolve(__dirname, '..', '..', 'app');

// ---------------------------------------------------------------------------
// Loading the screen, and the two rules that are easy to get wrong silently:
// the funnel marker must go out exactly once per screen open, and a signed-out
// deep link must land on the sign-in form rather than on an error box.
// ---------------------------------------------------------------------------

const ACCOUNTS = {
  accounts: [
    { id: 'goal-1', name: 'Vacation', type: 'savings' },
    { id: 'chq-1', name: 'Chequing', type: 'chequing' },
  ],
};
const TIMEZONE = { timezone: 'America/Toronto' };
const TIMELINE = {
  ok: true,
  balancesStartDate: '2026-09-01',
  openingBalance: 1000,
  closingBalance: 500,
  todayBalance: 900,
  days: [],
  dip: null,
  nextIncomeDate: null,
  unbalancedDays: [],
};

/** Records every path requested, answering from a fixture table. */
function recorder(overrides: Record<string, unknown> = {}) {
  const paths: string[] = [];
  const get = async <T,>(path: string): Promise<T> => {
    paths.push(path);
    if (path in overrides) {
      const value = overrides[path];
      if (value instanceof Error) throw value;
      return value as T;
    }
    if (path === '/api/accounts') return ACCOUNTS as T;
    if (path === '/api/household/timezone') return TIMEZONE as T;
    if (path.startsWith('/api/timeline')) return TIMELINE as T;
    throw new Error(`unexpected path ${path}`);
  };
  return { paths, get, timelineCalls: () => paths.filter((p) => p.startsWith('/api/timeline')) };
}

const AT = () => new Date('2026-09-15T16:00:00Z'); // noon-ish in Toronto

describe('the timeline_opened marker', () => {
  it('goes out on the screen open', async () => {
    const r = recorder();
    await createTimelineLoader(r.get, AT).load('open');
    expect(r.timelineCalls()).toEqual(['/api/timeline?account=chq-1&pageView=1']);
  });

  it('never goes out for a refresh, even as the first request', async () => {
    // Pins the TRIGGER, not the flag. In the test below, the open has already
    // set the flag, so dropping the trigger check entirely still passed —
    // mutation-tested and survived until this case existed.
    const r = recorder();
    await createTimelineLoader(r.get, AT).load('refresh');
    expect(r.timelineCalls()).toEqual(['/api/timeline?account=chq-1']);
  });

  it('does NOT go out on pull-to-refresh', async () => {
    // The web page sends it once per mount; a refresh that re-sent it would
    // log a second, third, tenth "Timeline opened" for one session and make
    // the mobile figure mean something different from the web one.
    const r = recorder();
    const loader = createTimelineLoader(r.get, AT);
    await loader.load('open');
    await loader.load('refresh');
    await loader.load('refresh');
    expect(r.timelineCalls()).toEqual([
      '/api/timeline?account=chq-1&pageView=1',
      '/api/timeline?account=chq-1',
      '/api/timeline?account=chq-1',
    ]);
  });

  it('goes out once even if the screen loads twice', async () => {
    // A remount, a retry after an error, or React invoking the effect twice
    // in development: still one open.
    const r = recorder();
    const loader = createTimelineLoader(r.get, AT);
    await loader.load('open');
    await loader.load('open');
    expect(r.timelineCalls().filter((p) => p.includes('pageView=1'))).toHaveLength(1);
  });

  it('is still owed when the failure happened before the timeline request', async () => {
    // /api/accounts fell over, so the route was never reached and logged
    // nothing. Marking the marker sent would lose this session's open
    // entirely — so the retry, on the SAME loader, must still carry it.
    const paths: string[] = [];
    let accountsDown = true;
    const get = async <T,>(path: string): Promise<T> => {
      paths.push(path);
      if (path === '/api/accounts') {
        if (accountsDown) throw new Error('network');
        return ACCOUNTS as T;
      }
      if (path === '/api/household/timezone') return TIMEZONE as T;
      return TIMELINE as T;
    };

    const loader = createTimelineLoader(get, AT);
    await expect(loader.load('open')).rejects.toThrow('network');
    expect(loader.pageViewSent).toBe(false);

    accountsDown = false;
    await loader.load('open');
    expect(paths.filter((p) => p.includes('pageView=1'))).toHaveLength(1);
  });

  it('counts as sent once the request is issued, even if it then fails', async () => {
    // The route logs the event before anything that can fail, so that open
    // WAS recorded server-side; claiming otherwise would double-count it.
    const r = recorder({ '/api/timeline?account=chq-1&pageView=1': new Error('server') });
    const loader = createTimelineLoader(r.get, AT);
    await expect(loader.load('open')).rejects.toThrow('server');
    expect(loader.pageViewSent).toBe(true);
  });
});

describe('timelinePath', () => {
  it('escapes the account id rather than pasting it into the query', () => {
    expect(timelinePath('a b&pageView=1', false)).toBe('/api/timeline?account=a%20b%26pageView%3D1');
  });
});

describe('what the loader reports', () => {
  it('finds the chequing account among other account types', async () => {
    const r = recorder();
    const load = await createTimelineLoader(r.get, AT).load('open');
    expect(load.kind).toBe('ready');
    expect(r.timelineCalls()[0]).toContain('account=chq-1');
  });

  it('resolves today in the household timezone, not the device one', async () => {
    // 2026-09-16T02:30Z is still 15 September in Toronto. A device-clock
    // "today" would slice the wrong month on the 1st of a month.
    const r = recorder();
    const load = await createTimelineLoader(r.get, () => new Date('2026-09-16T02:30:00Z')).load('open');
    expect(load).toMatchObject({ kind: 'ready', today: '2026-09-15' });
  });

  it('uses the zone the route returns, not the Toronto default', async () => {
    // Toronto is both the real value for every household today AND the
    // fallback, so a test that only checks Toronto cannot tell the two apart:
    // replacing the response with the constant would pass it. This zone is
    // 18 hours from Toronto, so only the real value gives this date.
    const r = recorder({ '/api/household/timezone': { timezone: 'Pacific/Kiritimati' } });
    const load = await createTimelineLoader(r.get, () => new Date('2026-09-15T13:00:00Z')).load('open');
    expect(load).toMatchObject({ kind: 'ready', today: '2026-09-16', timezone: 'Pacific/Kiritimati' });
  });

  it('falls back to the default zone only when the route sends no usable value', async () => {
    const r = recorder({ '/api/household/timezone': { timezone: '' } });
    const load = await createTimelineLoader(r.get, AT).load('open');
    expect(load).toMatchObject({ kind: 'ready', timezone: 'America/Toronto' });
  });

  it('says noChequing when the household has no chequing account', async () => {
    const r = recorder({ '/api/accounts': { accounts: [{ id: 'g', name: 'Goal', type: 'savings' }] } });
    expect(await createTimelineLoader(r.get, AT).load('open')).toEqual({ kind: 'noChequing' });
    // And never asks for a timeline it cannot ask for.
    expect(r.timelineCalls()).toEqual([]);
  });

  it('says noAnchor when the route refuses for want of an anchor', async () => {
    const r = recorder({ '/api/timeline?account=chq-1&pageView=1': { ok: false, reason: 'no_anchor' } });
    expect(await createTimelineLoader(r.get, AT).load('open')).toEqual({ kind: 'noAnchor' });
  });

  it('propagates a timezone failure instead of guessing the zone', async () => {
    // The web hook falls back to America/Toronto silently. Here the whole
    // screen depends on which day it is, so a failure is reported, not hidden.
    const r = recorder({ '/api/household/timezone': new Error('server') });
    await expect(createTimelineLoader(r.get, AT).load('open')).rejects.toThrow('server');
  });
});

describe('the auth gate on a deep link', () => {
  it('sends a signed-out visitor to sign-in, not to an error box', () => {
    // /timeline is directly reachable. Ungated, the screen would render, its
    // first request would 401, and the user would read "your session has
    // ended" with no way to act on it.
    expect(gateView({ status: 'signedOut' })).toBe('signIn');
  });

  it('waits rather than flashing sign-in at a signed-in user', () => {
    expect(gateView({ status: 'loading' })).toBe('loading');
  });

  it('renders the screen for a signed-in user', () => {
    expect(gateView({ status: 'signedIn', session: {} as never })).toBe('content');
  });

  // gateView decides correctly; these two assertions are what tie that
  // decision to the actual routes. STRUCTURAL, not behavioural: nothing here
  // renders a component, so "the gate is wired to the route" is checked by
  // reading the route files. A render test needs a React Native renderer,
  // which this app does not have — stated in the handoff rather than implied.
  it.each(['index.tsx', 'timeline.tsx'])('app/%s wraps its screen in the gate', (file) => {
    const source = fs.readFileSync(path.join(APP_DIR, file), 'utf8');
    expect(source).toMatch(/import AuthGate from '\.\.\/src\/components\/AuthGate'/);
    expect(source).toMatch(/<AuthGate>[\s\S]*<\/AuthGate>/);
  });
});

import { describe, it, expect } from 'vitest';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { loadHouseholdState } from '../lib/householdGate';
import type { Getter } from '../lib/timelineLoader';

function getter(me: unknown, dashboard: unknown = { hasPlan: true }) {
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    if (path === '/api/me') return me;
    if (path === '/api/dashboard?snapshotOnly=1') return dashboard;
    throw new Error(`unexpected ${path}`);
  }) as Getter;
  return { get, asked };
}

describe('the terms gate', () => {
  it('lets a household with current terms through', async () => {
    expect(await loadHouseholdState(getter({ termsCurrent: true }).get)).toEqual({ kind: 'ready' });
  });

  it('blocks when the server says the terms are not current', async () => {
    expect(await loadHouseholdState(getter({ termsCurrent: false }).get)).toEqual({ kind: 'termsOutdated' });
  });

  it.each<[unknown, string]>([
    [{}, 'missing'],
    [{ termsCurrent: 'false' }, 'a string'],
    [{ termsCurrent: null }, 'null'],
    [null, 'no body'],
  ])('refuses to guess when termsCurrent is %j (%s)', async (me) => {
    await expect(loadHouseholdState(getter(me).get)).rejects.toThrow('termsCurrent');
  });

  it('propagates a failed /api/me', async () => {
    const get = (async () => {
      throw new Error('down');
    }) as Getter;
    await expect(loadHouseholdState(get)).rejects.toThrow('down');
  });
});

describe('the plan gate', () => {
  it('sends a household with no plan to onboarding', async () => {
    expect(await loadHouseholdState(getter({ termsCurrent: true }, { hasPlan: false }).get)).toEqual({
      kind: 'needsPlan',
    });
  });

  it('never asks the dashboard for someone blocked on terms', async () => {
    // The dashboard logs a daily heartbeat and materialises bridge rows; a
    // blocked person must not trigger either for a screen they cannot see.
    const g = getter({ termsCurrent: false }, { hasPlan: false });
    await loadHouseholdState(g.get);
    expect(g.asked).toEqual(['/api/me']);
  });

  it('asks for the snapshot only, so a launch never logs a review as read', async () => {
    // The full /api/dashboard load logs viewed_monthly_review, and the gate
    // shows no review. Exact path: a bare /api/dashboard here is the bug.
    const g = getter({ termsCurrent: true });
    await loadHouseholdState(g.get);
    expect(g.asked).toEqual(['/api/me', '/api/dashboard?snapshotOnly=1']);
  });

  it.each<[unknown, string]>([
    [{}, 'missing'],
    [{ hasPlan: 'true' }, 'a string'],
    [{ hasPlan: null }, 'null'],
  ])('refuses to guess when hasPlan is %j (%s)', async (dashboard) => {
    await expect(loadHouseholdState(getter({ termsCurrent: true }, dashboard).get)).rejects.toThrow('hasPlan');
  });
});

describe('the terms block copy', () => {
  it('says exactly what was asked, in English', () => {
    expect(en.terms.updated).toBe(
      'Our terms were updated. Review and accept them on phare.money, then sign in again.'
    );
  });

  it.each([
    ['en', en.terms.updated],
    ['fr', fr.terms.updated],
  ])('%s carries no link and no figure', (_locale, text) => {
    expect(text).not.toMatch(/https?:|www\.|\/\/|\$|\d/);
  });
});

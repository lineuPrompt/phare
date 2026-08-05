import { describe, it, expect } from 'vitest';
import { requirePro } from '@/lib/proGate';

// The pricing card is the contract. These tests pin both halves of that:
// what the gate refuses, and — just as important — that it fails CLOSED rather
// than giving the product away on a database hiccup.

function reader(row: unknown, error: unknown = null) {
  const chain = (): unknown =>
    new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: row, error }).then(resolve);
        }
        return () => chain();
      },
    });
  return { from: () => ({ select: () => chain() }) };
}

const PRO = { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null };
const FREE = { subscription_status: null, subscription_current_period_end: null, comp_until: null };
const COMPED = { subscription_status: null, subscription_current_period_end: null, comp_until: '2099-11-01' };
const LAPSED = { subscription_status: 'canceled', subscription_current_period_end: '2020-01-01T00:00:00Z', comp_until: null };

describe('requirePro', () => {
  it('allows a paying household', async () => {
    expect(await requirePro(reader(PRO), 'hh1', 'audit')).toEqual({ allowed: true });
  });

  it('allows a COMPED household — a comp is entitlement, not a discount', async () => {
    expect(await requirePro(reader(COMPED), 'hh1', 'audit')).toEqual({ allowed: true });
  });

  it('refuses a free household with 403 and a code the UI can key off', async () => {
    const r = await requirePro(reader(FREE), 'hh1', 'audit');
    expect(r.allowed).toBe(false);
    if (r.allowed) throw new Error('unreachable');

    expect(r.response.status).toBe(403);
    const body = await r.response.json();
    // A paywall surfacing as "something went wrong" teaches people the product
    // is broken. The code is what lets the UI render a padlock instead.
    expect(body.code).toBe('pro_required');
    expect(body.locked).toBe(true);
    expect(body.feature).toBe('audit');
  });

  it('refuses a lapsed subscription', async () => {
    const r = await requirePro(reader(LAPSED), 'hh1', 'new_plan');
    expect(r.allowed).toBe(false);
  });

  it('FAILS CLOSED when the household row cannot be read', async () => {
    // Defaulting to allowed on a database error would give the product away on
    // exactly the failures nobody notices.
    const r = await requirePro(reader(null, { message: 'boom' }), 'hh1', 'audit');
    expect(r.allowed).toBe(false);
  });

  it('fails closed when the row is missing entirely', async () => {
    expect((await requirePro(reader(null), 'hh1', 'audit')).allowed).toBe(false);
  });

  it('carries the feature name through, so refusals are distinguishable', async () => {
    for (const feature of ['audit', 'new_plan', 'custom_categories']) {
      const r = await requirePro(reader(FREE), 'hh1', feature);
      if (r.allowed) throw new Error('unreachable');
      expect((await r.response.json()).feature).toBe(feature);
    }
  });
});

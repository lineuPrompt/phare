/**
 * Where a Timeline row links to.
 *
 * The bug this pins (fixed 2026-09-01): a materialized goal contribution
 * carries BOTH recurringItemId and transferPeerId, and the recurringItemId
 * branch was evaluated first — so clicking a contribution landed on
 * /recurring, the generic rules list, instead of /savings where the
 * contribution editor lives. Precedence between the branches IS the
 * behaviour here, so it is asserted as a matrix rather than one case.
 */

import { describe, it, expect } from 'vitest';
import { sourceHref } from '../DayLedger';

type Entry = Parameters<typeof sourceHref>[0];

const entry = (o: Partial<Entry> & Pick<Entry, 'type'>): Entry => ({
  isBridge: false,
  recurringItemId: null,
  transferPeerId: null,
  bridgeSourceAccount: null,
  bridgeSourceMonth: null,
  ...o,
});

describe('sourceHref', () => {
  it('THE REGRESSION: a materialized contribution goes to /savings, not /recurring', () => {
    // Both fields set — this is exactly what create_transfer writes.
    const contribution = entry({ type: 'transfer', recurringItemId: 'rule-1', transferPeerId: 'peer-1' });
    expect(sourceHref(contribution, 'en')).toBe('/en/savings');
    expect(sourceHref(contribution, 'fr')).toBe('/fr/savings');
  });

  it('a one-off transfer also goes to /savings', () => {
    expect(sourceHref(entry({ type: 'transfer', transferPeerId: 'peer-1' }), 'en')).toBe('/en/savings');
  });

  it('a transfer with neither link still goes to /savings', () => {
    // A goal opening balance is one-sided: no peer, no rule. It is still a
    // goal row and /reconcile would be the wrong destination for it.
    expect(sourceHref(entry({ type: 'transfer' }), 'en')).toBe('/en/savings');
  });

  it('a recurring EXPENSE still goes to /recurring — unchanged', () => {
    expect(sourceHref(entry({ type: 'expense', recurringItemId: 'rule-2' }), 'en')).toBe('/en/recurring');
  });

  it('a recurring INCOME still goes to /recurring — unchanged', () => {
    expect(sourceHref(entry({ type: 'income', recurringItemId: 'rule-3' }), 'en')).toBe('/en/recurring');
  });

  it('a plain one-off entry still goes to /reconcile — unchanged', () => {
    expect(sourceHref(entry({ type: 'expense' }), 'en')).toBe('/en/reconcile');
  });

  it('a bridge row still wins over everything and keeps its card+month params', () => {
    const bridge = entry({
      type: 'expense', isBridge: true,
      bridgeSourceAccount: 'card-1', bridgeSourceMonth: '2026-08',
    });
    expect(sourceHref(bridge, 'en')).toBe('/en/cards?card=card-1&month=2026-08');
  });

  it('a bridge row with no source params degrades to the bare Cards page', () => {
    expect(sourceHref(entry({ type: 'expense', isBridge: true }), 'fr')).toBe('/fr/cards');
  });

  it('a bridge row beats the transfer branch, not the other way round', () => {
    // Ordering guard: the transfer branch was inserted above the recurring
    // one, and must stay below the bridge one.
    const bridged = entry({ type: 'transfer', isBridge: true, bridgeSourceAccount: 'card-9' });
    expect(sourceHref(bridged, 'en')).toBe('/en/cards?card=card-9');
  });
});

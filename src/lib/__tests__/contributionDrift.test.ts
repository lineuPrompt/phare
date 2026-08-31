import { describe, it, expect } from 'vitest';
import { computeContributionDrift } from '../contributionDrift';

// The live database is what found the effective_from case: the reserve
// buffer's 2026-09-30 row at $350 sat under a $628.02 rule effective
// 2026-10-01, and the first cut of this helper called it drift. It is not —
// it is the forward-apply promise being kept. Pinned here so it stays fixed.
describe('computeContributionDrift', () => {
  const rows = (...specs: [string, number][]) => specs.map(([date, amount]) => ({ date, amount }));

  it('returns null when every owned row matches the rule', () => {
    expect(computeContributionDrift(rows(['2026-09-09', 25], ['2026-09-23', 25]), 25, null)).toBeNull();
  });

  it('reports hand-edited rows that no longer match', () => {
    const drift = computeContributionDrift(rows(['2026-09-09', 125], ['2026-09-23', 125]), 25, null);
    expect(drift).toEqual({ count: 2, amounts: [125], ruleAmount: 25 });
  });

  it('EXCLUDES rows dated before the rule took effect', () => {
    // September still belongs to the frozen predecessor at $350; the current
    // rule only owns October onward and is matched there.
    const drift = computeContributionDrift(
      rows(['2026-09-30', 350], ['2026-10-30', 628.02], ['2026-11-30', 628.02]),
      628.02,
      '2026-10-01'
    );
    expect(drift).toBeNull();
  });

  it('still reports drift AFTER the effective date', () => {
    const drift = computeContributionDrift(
      rows(['2026-09-30', 350], ['2026-10-30', 999]),
      628.02,
      '2026-10-01'
    );
    expect(drift).toEqual({ count: 1, amounts: [999], ruleAmount: 628.02 });
  });

  it('compares magnitudes, so a debt payment pair is not false-flagged', () => {
    expect(computeContributionDrift(rows(['2026-09-09', -200]), 200, null)).toBeNull();
  });

  it('tolerates sub-cent float noise', () => {
    expect(computeContributionDrift(rows(['2026-09-09', 628.0201]), 628.02, null)).toBeNull();
  });

  it('lists each distinct differing amount once, ascending', () => {
    const drift = computeContributionDrift(
      rows(['2026-09-09', 125], ['2026-09-23', 50], ['2026-10-07', 125]),
      25,
      null
    );
    expect(drift).toEqual({ count: 3, amounts: [50, 125], ruleAmount: 25 });
  });

  it('returns null with no rule or no rows', () => {
    expect(computeContributionDrift(rows(['2026-09-09', 125]), null, null)).toBeNull();
    expect(computeContributionDrift([], 25, null)).toBeNull();
  });
});

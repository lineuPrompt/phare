import { describe, it, expect } from 'vitest';
import { computeTypicalSurplus, computeInsufficientHistory } from '@/lib/coachingHelpers';

// ---------------------------------------------------------------------------
// The dilution bug, pinned at the boundary where it actually lived.
//
// computeTypicalSurplus was never wrong: it averages over the months it is
// given. The CALLER passed a fixed three-element window including months with
// no data, so empty months contributed 0 to the mean.
//
// Second instance of this shape after the trailing variable average. These
// tests describe the contract both sides now rely on, so a future caller that
// re-introduces a fixed window has something to fail against.
// ---------------------------------------------------------------------------

const m = (month: string, netCashFlow: number, windfallExtra = 0) =>
  ({ month, netCashFlow, windfallExtra });

describe('computeTypicalSurplus — averages over what it is given', () => {
  it('one real month reports THAT month, not a third of it', () => {
    // The bug in one line: [+$900, empty, empty] averaged to $300 and was
    // labelled "typical" — a threefold understatement of the only month that
    // exists, shown to every newly-onboarded household.
    expect(computeTypicalSurplus([m('2026-08', 900)])).toEqual({
      typicalSurplus: 900,
      monthsUsed: 1,
    });
  });

  it('demonstrates what the old caller produced, so the size of the error is legible', () => {
    const diluted = computeTypicalSurplus([m('2026-08', 900), m('2026-07', 0), m('2026-06', 0)]);
    expect(diluted).toEqual({ typicalSurplus: 300, monthsUsed: 3 });
    // Three times smaller than the truth.
    expect(diluted!.typicalSurplus * 3).toBe(900);
  });

  it('two real months average over two', () => {
    expect(computeTypicalSurplus([m('2026-08', 900), m('2026-07', 500)]))
      .toEqual({ typicalSurplus: 700, monthsUsed: 2 });
  });

  it('a genuine zero month still counts — it happened', () => {
    // The fix filters months with NO DATA, not months that netted zero. A month
    // where income equalled outgoings is a real observation and belongs in the
    // average.
    expect(computeTypicalSurplus([m('2026-08', 900), m('2026-07', 0)]))
      .toEqual({ typicalSurplus: 450, monthsUsed: 2 });
  });

  it('windfalls are netted out before averaging', () => {
    // A three-paycheque month must not inflate what looks like ongoing room.
    expect(computeTypicalSurplus([m('2026-08', 1400, 500)]))
      .toEqual({ typicalSurplus: 900, monthsUsed: 1 });
  });

  it('null for no months at all — reachable now that empties are filtered out', () => {
    // Previously unreachable: the caller always passed three elements. Both
    // consumers handle null explicitly (computeStartingContribution returns 0,
    // coachingFallbackApplies treats it as no surplus).
    expect(computeTypicalSurplus([])).toBeNull();
  });
});

describe('insufficientHistory still sees the FULL window', () => {
  it('fires on one real month out of three, so the figure is disclosed as thin', () => {
    // This is the half that must NOT be filtered. The surplus is now honest
    // about its size; this keeps it honest about its confidence.
    expect(computeInsufficientHistory([
      { month: '2026-08', hasRealData: true },
      { month: '2026-07', hasRealData: false },
      { month: '2026-06', hasRealData: false },
    ])).toBe(true);
  });

  it('does not fire at three real months', () => {
    expect(computeInsufficientHistory([
      { month: '2026-08', hasRealData: true },
      { month: '2026-07', hasRealData: true },
      { month: '2026-06', hasRealData: true },
    ])).toBe(false);
  });

  it('filtering ITS input would silence the caveat — the thing not to do', () => {
    // If someone "tidies" this to receive the same filtered list as
    // computeTypicalSurplus, a one-month household reads as having full history
    // and the conservative-figure disclosure disappears.
    const full = [
      { month: '2026-08', hasRealData: true },
      { month: '2026-07', hasRealData: false },
      { month: '2026-06', hasRealData: false },
    ];
    expect(computeInsufficientHistory(full)).toBe(true);
    expect(computeInsufficientHistory(full.filter((x) => x.hasRealData))).toBe(true);
    // Both true here only because 1 < 3. The failure appears at three real
    // months plus padding, which cannot occur — but the asymmetry is the point:
    // one function wants real months, the other wants the intended window.
  });
});

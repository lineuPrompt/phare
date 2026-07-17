import { describe, it, expect } from 'vitest';
import {
  monthsBetween,
  addMonthsToMonth,
  excelSerialToISODate,
  parseMonthYearText,
  parseGoalTargetDate,
  requiredMonthlyContribution,
  achievableMonth,
  evaluateGoals,
  isDebtGoalName,
  computeDebtPayoff,
  projectedContribution,
  type ContributionRule,
} from '../goalHelpers';

describe('monthsBetween', () => {
  it('counts whole calendar months forward', () => {
    expect(monthsBetween('2026-07', '2028-01')).toBe(18);
  });
  it('is zero for the same month', () => {
    expect(monthsBetween('2026-07-10', '2026-07-01')).toBe(0);
  });
  it('is negative for a month in the past', () => {
    expect(monthsBetween('2026-07', '2026-01')).toBe(-6);
  });
});

describe('addMonthsToMonth', () => {
  it('rolls over a year boundary', () => {
    expect(addMonthsToMonth('2026-07', 6)).toBe('2027-01');
  });
});

describe('excelSerialToISODate', () => {
  it('decodes the Disney goal serial to 2028-01-01', () => {
    expect(excelSerialToISODate(46753)).toBe('2028-01-01');
  });
  it('decodes the Brazil goal serial to 2028-12-28', () => {
    expect(excelSerialToISODate(47115)).toBe('2028-12-28');
  });
  it('rejects a non-positive serial', () => {
    expect(excelSerialToISODate(0)).toBeNull();
    expect(excelSerialToISODate(-5)).toBeNull();
  });
});

describe('parseMonthYearText', () => {
  it('parses a full English month name plus year', () => {
    expect(parseMonthYearText('September 2026')).toBe('2026-09-01');
  });
  it('parses a full French month name plus year', () => {
    expect(parseMonthYearText('Septembre 2026')).toBe('2026-09-01');
  });
  it('returns null for an abbreviated, ambiguous style like "Jan-28"', () => {
    expect(parseMonthYearText('Jan-28')).toBeNull();
  });
  it('returns null for text with no year', () => {
    expect(parseMonthYearText('September')).toBeNull();
  });
});

describe('parseGoalTargetDate', () => {
  it('accepts a numeric Excel serial', () => {
    expect(parseGoalTargetDate(46753)).toEqual({ date: '2028-01-01', flagged: false });
  });
  it('accepts recognizable month+year text', () => {
    expect(parseGoalTargetDate('September 2026')).toEqual({ date: '2026-09-01', flagged: false });
  });
  it('treats a blank cell as legitimately dateless, not flagged', () => {
    expect(parseGoalTargetDate(null)).toEqual({ date: null, flagged: false });
    expect(parseGoalTargetDate('   ')).toEqual({ date: null, flagged: false });
  });
  it('flags unparseable non-empty text rather than silently dropping it', () => {
    expect(parseGoalTargetDate('Jan-28')).toEqual({ date: null, flagged: true });
  });
  it('flags a non-positive numeric serial', () => {
    expect(parseGoalTargetDate(-3)).toEqual({ date: null, flagged: true });
  });
});

describe('requiredMonthlyContribution', () => {
  it('is funded when saved already meets or exceeds target', () => {
    expect(requiredMonthlyContribution(1000, 1000, '2028-01-01', '2026-07-10')).toEqual({ status: 'funded' });
    expect(requiredMonthlyContribution(1000, 1500, '2028-01-01', '2026-07-10')).toEqual({ status: 'funded' });
  });
  it('is no_date when no target date was given', () => {
    expect(requiredMonthlyContribution(1000, 0, null, '2026-07-10')).toEqual({ status: 'no_date' });
  });
  it('is past_due for a target month equal to the current month (no negative/zero division)', () => {
    expect(requiredMonthlyContribution(1000, 0, '2026-07-15', '2026-07-10')).toEqual({ status: 'past_due' });
  });
  it('is past_due for a target month before the current month', () => {
    expect(requiredMonthlyContribution(1000, 0, '2026-01-01', '2026-07-10')).toEqual({ status: 'past_due' });
  });
  it('computes (target - saved) / months for a valid future target', () => {
    expect(requiredMonthlyContribution(6000, 0, '2028-01-01', '2026-07-10')).toEqual({
      status: 'ok', monthlyRequired: 333.33, monthsToTarget: 18,
    });
  });

  // ---------------------------------------------------------------------
  // Negative domain — debt (Build 4 Phase 3). Debt is target=0, saved=the
  // current negative balance. Per spec this works UNCHANGED: no special
  // debt branch in the function itself.
  // ---------------------------------------------------------------------
  it('debt: computes the required monthly payment from a negative balance toward target 0', () => {
    // Owes $5000, target $0, 18 months to payoff.
    expect(requiredMonthlyContribution(0, -5000, '2028-01-01', '2026-07-10')).toEqual({
      status: 'ok', monthlyRequired: 277.78, monthsToTarget: 18,
    });
  });

  it('debt: is funded (paid off) exactly when the negative balance reaches 0', () => {
    expect(requiredMonthlyContribution(0, 0, '2028-01-01', '2026-07-10')).toEqual({ status: 'funded' });
    expect(requiredMonthlyContribution(0, -0.01, '2028-01-01', '2026-07-10')).not.toEqual({ status: 'funded' });
  });

  it('debt: a balance that has gone positive (overpayment) still reads funded, never negative-required', () => {
    expect(requiredMonthlyContribution(0, 50, '2028-01-01', '2026-07-10')).toEqual({ status: 'funded' });
  });

  it('debt: past_due works the same way in the negative domain', () => {
    expect(requiredMonthlyContribution(0, -3000, '2026-01-01', '2026-07-10')).toEqual({ status: 'past_due' });
  });

  it('debt: no_date works the same way in the negative domain', () => {
    expect(requiredMonthlyContribution(0, -3000, null, '2026-07-10')).toEqual({ status: 'no_date' });
  });

  it('debt: monthlyRequired shrinks as the balance climbs toward 0 across payments', () => {
    const early = requiredMonthlyContribution(0, -5000, '2028-01-01', '2026-07-10');
    const later = requiredMonthlyContribution(0, -3000, '2028-01-01', '2026-07-10');
    expect(early.status).toBe('ok');
    expect(later.status).toBe('ok');
    if (early.status === 'ok' && later.status === 'ok') {
      expect(later.monthlyRequired).toBeLessThan(early.monthlyRequired);
    }
  });
});

describe('achievableMonth', () => {
  it('is this month when already funded (remaining <= 0)', () => {
    expect(achievableMonth(1000, 1000, 500, '2026-07-10')).toBe('2026-07');
  });
  it('is null when capacity is zero or negative and not funded', () => {
    expect(achievableMonth(1000, 0, 0, '2026-07-10')).toBeNull();
    expect(achievableMonth(1000, 0, -50, '2026-07-10')).toBeNull();
  });
  it('rounds up to the month the remaining amount is fully covered', () => {
    expect(achievableMonth(1000, 0, 300, '2026-07-10')).toBe('2026-11'); // ceil(1000/300)=4 months from July
  });
});

describe('evaluateGoals', () => {
  const today = '2026-07-10';

  it('marks a single goal on-track when its required contribution fits capacity', () => {
    const [g] = evaluateGoals(
      [{ name: 'Disney', targetAmount: 6000, savedSoFar: 0, targetDate: '2028-01-01' }],
      500,
      today
    );
    expect(g.onTrack).toBe(true);
    expect(g.monthlyContribution).toBe(333.33);
    expect(g.estimatedDate).toBe('2028-01');
    expect(g.fundedAlready).toBe(false);
    expect(g.pastDue).toBe(false);
  });

  it('reports the honest alternative date when capacity cannot support the stated date', () => {
    // Needs $333.33/mo for Jan 2028, but only $100/mo capacity exists.
    const [g] = evaluateGoals(
      [{ name: 'Disney', targetAmount: 6000, savedSoFar: 0, targetDate: '2028-01-01' }],
      100,
      today
    );
    expect(g.onTrack).toBe(false);
    expect(g.monthlyContribution).toBe(333.33); // still shows what the STATED date would need
    expect(g.estimatedDate).not.toBe('2028-01'); // never silently retargeted to look on-track
    expect(g.estimatedDate).toBe('2031-07'); // ceil(6000/100)=60 months from July 2026
  });

  it('shares one capacity pool across multiple goals — both fit', () => {
    const results = evaluateGoals(
      [
        { name: 'Disney', targetAmount: 6000, savedSoFar: 0, targetDate: '2028-01-01' }, // 333.33/mo
        { name: 'Brazil', targetAmount: 3000, savedSoFar: 0, targetDate: '2028-12-28' }, // ~29 months -> ~103.45/mo
      ],
      500, // combined ~436.78 fits in 500
      today
    );
    expect(results.every((g) => g.onTrack)).toBe(true);
  });

  it('shares one capacity pool across multiple goals — combined ask exceeds capacity, neither is on track', () => {
    const results = evaluateGoals(
      [
        { name: 'Disney', targetAmount: 6000, savedSoFar: 0, targetDate: '2028-01-01' }, // 333.33/mo
        { name: 'Brazil', targetAmount: 3000, savedSoFar: 0, targetDate: '2028-12-28' }, // ~103.45/mo
      ],
      400, // combined ~436.78 does not fit in 400
      today
    );
    expect(results.every((g) => !g.onTrack)).toBe(true);
  });

  it('marks a goal already funded, with no fabricated contribution or timeline', () => {
    const [g] = evaluateGoals(
      [{ name: 'Emergency fund', targetAmount: 2000, savedSoFar: 2000, targetDate: '2027-01-01' }],
      500,
      today
    );
    expect(g).toMatchObject({ fundedAlready: true, onTrack: true, monthlyContribution: 0 });
  });

  it('leaves a dateless goal without any on-track/estimate claim', () => {
    const [g] = evaluateGoals(
      [{ name: 'Someday fund', targetAmount: 5000, savedSoFar: 0, targetDate: null }],
      500,
      today
    );
    expect(g).toMatchObject({ hasTargetDate: false, onTrack: false, estimatedDate: null, monthlyContribution: 0 });
  });

  it('computes an honest alternative date for a past-due goal', () => {
    const [g] = evaluateGoals(
      [{ name: 'Overdue trip', targetAmount: 1000, savedSoFar: 0, targetDate: '2026-01-01' }],
      200,
      today
    );
    expect(g.pastDue).toBe(true);
    expect(g.onTrack).toBe(false);
    expect(g.estimatedDate).toBe('2026-12'); // ceil(1000/200)=5 months from July 2026
  });
});

describe('isDebtGoalName', () => {
  it('matches the founder fixture\'s bilingual debt goal name', () => {
    expect(isDebtGoalName('Pay off credit line / Rembourser marge')).toBe(true);
  });
  it('matches a plain French name via keyword alone', () => {
    expect(isDebtGoalName('Rembourser ma dette')).toBe(true);
  });
  it('does not match an ordinary savings goal', () => {
    expect(isDebtGoalName('Theme Park trip')).toBe(false);
    expect(isDebtGoalName('Europe trip')).toBe(false);
    expect(isDebtGoalName('Emergency fund')).toBe(false);
  });
});

describe('computeDebtPayoff', () => {
  const today = '2026-07-10';

  it('computes the same monthly figure requiredMonthlyContribution would, for the debt goal alone', () => {
    const debtGoal = { name: 'Pay off credit line', targetAmount: 5000, savedSoFar: 0, targetDate: '2026-09-01' };
    const result = computeDebtPayoff(debtGoal, today);
    const direct = requiredMonthlyContribution(5000, 0, '2026-09-01', today);
    expect(direct.status).toBe('ok');
    expect(result).toEqual({
      description: 'Pay off credit line',
      targetDate: '2026-09',
      monthlyPayment: direct.status === 'ok' ? direct.monthlyRequired : NaN,
    });
  });

  it('is null when no debt goal was found', () => {
    expect(computeDebtPayoff(undefined, today)).toBeNull();
  });

  it('is null once the debt is already paid off — no fabricated $0 card', () => {
    expect(computeDebtPayoff({ name: 'Pay off credit line', targetAmount: 5000, savedSoFar: 5000, targetDate: '2026-09-01' }, today)).toBeNull();
  });

  it('is null when the debt goal has no target date', () => {
    expect(computeDebtPayoff({ name: 'Pay off credit line', targetAmount: 5000, savedSoFar: 0, targetDate: null }, today)).toBeNull();
  });

  it('is null when the target date has already passed — never shows a stale card', () => {
    expect(computeDebtPayoff({ name: 'Pay off credit line', targetAmount: 5000, savedSoFar: 0, targetDate: '2026-01-01' }, today)).toBeNull();
  });

  // -------------------------------------------------------------------
  // Explicit debt-type convention (Build 4 Phase 3): target=0, savedSoFar
  // is the account's own negative balance — used by GET /api/goals and
  // regenerate-plan for an explicitly-typed debt account, instead of the
  // positive-target/zero-start convention the isDebtGoalName heuristic
  // path above uses. Same pure function, same result shape either way.
  // -------------------------------------------------------------------
  it('explicit debt-type convention: target 0, saved = negative balance, produces the same payoff math', () => {
    const result = computeDebtPayoff({ name: "Emma's line", targetAmount: 0, savedSoFar: -5000, targetDate: '2026-09-01' }, today);
    expect(result).toEqual({
      description: "Emma's line",
      targetDate: '2026-09',
      monthlyPayment: 5000 / 2, // 2 months (Jul 10 -> Sep 1 is 2 whole calendar months)
    });
  });

  it('explicit debt-type convention: null once the balance reaches 0 (paid off), no fabricated card', () => {
    expect(computeDebtPayoff({ name: "Emma's line", targetAmount: 0, savedSoFar: 0, targetDate: '2026-09-01' }, today)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// projectedContribution — Build 4 Phase 2 (recurring transfers)
// ---------------------------------------------------------------------------

describe('projectedContribution', () => {
  const monthlyRule: ContributionRule = { cadence: 'monthly', anchorDate: '2026-08-01' };

  it('adds one occurrence per month for a monthly rule', () => {
    // 2026-08-01 through 2026-10-01 inclusive → Aug, Sep, Oct = 3 occurrences
    const total = projectedContribution(0, monthlyRule, 500, '2026-08-01', '2026-10-01');
    expect(total).toBe(1500);
  });

  it('adds the current balance on top of projected occurrences', () => {
    const total = projectedContribution(2000, monthlyRule, 500, '2026-08-01', '2026-10-01');
    expect(total).toBe(3500); // 2000 + 3×500
  });

  it('bi-weekly rule: three-occurrence months emerge naturally, same engine as materialization', () => {
    const biweekly: ContributionRule = { cadence: 'biweekly', anchorDate: '2026-01-02' };
    // A little over a year: enough to accumulate more than 26 occurrences.
    const total = projectedContribution(0, biweekly, 100, '2026-01-02', '2027-01-15');
    expect(total).toBeGreaterThan(26 * 100); // more than exactly 2/month over the year
  });

  it('returns the balance unchanged when toDate is on/before fromDate', () => {
    expect(projectedContribution(1000, monthlyRule, 500, '2026-08-01', '2026-08-01')).toBe(1000);
    expect(projectedContribution(1000, monthlyRule, 500, '2026-08-01', '2026-07-01')).toBe(1000);
  });

  it('returns the balance unchanged when the rule has no anchor date yet (needs a date)', () => {
    const needsDate: ContributionRule = { cadence: 'monthly', anchorDate: null };
    expect(projectedContribution(1000, needsDate, 500, '2026-08-01', '2027-08-01')).toBe(1000);
  });

  it('returns the balance unchanged when rule is null', () => {
    expect(projectedContribution(1000, null, 500, '2026-08-01', '2027-08-01')).toBe(1000);
  });

  it('never assumes a rate of return — result is exactly balance + occurrences×amount, nothing more', () => {
    const total = projectedContribution(6500, monthlyRule, 500, '2026-08-01', '2027-12-01');
    // Aug 2026 through Dec 2027 inclusive = 17 months = 17 occurrences
    expect(total).toBe(6500 + 17 * 500);
  });
});

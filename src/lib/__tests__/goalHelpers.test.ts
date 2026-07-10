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

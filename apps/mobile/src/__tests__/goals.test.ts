import { describe, it, expect } from 'vitest';
import { loadGoals, parseGoals } from '../lib/goals';
import type { Getter } from '../lib/timelineLoader';

// GET /api/goals, shaped as the route answers it (extra fields ignored).
const ANSWER = {
  goals: [
    { id: 'g1', name: 'Europe trip', type: 'savings', isDebt: false, balance: '1250.50', goalTarget: 5000, goalTargetDate: '2027-06-01', transfers: [], recurringContribution: { recurringItemId: 'r1', amount: '200', cadence: 'monthly' } },
    { id: 'g2', name: 'Line of credit', type: 'debt', isDebt: true, balance: -3400, goalTarget: 0, goalTargetDate: null, recurringContribution: null },
    { id: 'g3', name: 'Rainy day', type: 'savings', isDebt: false, balance: 0, goalTarget: null, goalTargetDate: null, recurringContribution: null },
  ],
};

describe('goals', () => {
  it('reads each goal as the server computed it — no figure recomputed here', () => {
    expect(parseGoals(ANSWER)).toEqual([
      { id: 'g1', name: 'Europe trip', isDebt: false, balance: 1250.5, target: 5000, targetDate: '2027-06-01', contribution: { amount: 200, cadence: 'monthly' } },
      { id: 'g2', name: 'Line of credit', isDebt: true, balance: -3400, target: 0, targetDate: null, contribution: null },
      { id: 'g3', name: 'Rainy day', isDebt: false, balance: 0, target: null, targetDate: null, contribution: null },
    ]);
  });

  it('no target stays null — never $0', () => {
    expect(parseGoals(ANSWER)[2].target).toBeNull();
  });

  it('a contribution with an unknown frequency is not shown as one', () => {
    const odd = { goals: [{ ...ANSWER.goals[0], recurringContribution: { amount: 5, cadence: 'daily' } }] };
    expect(parseGoals(odd)[0].contribution).toBeNull();
  });

  it('an answer with no list, or an unreadable balance, is an error — never "no goals"', () => {
    expect(() => parseGoals({ error: 'x' })).toThrow(/no goal list/);
    expect(() => parseGoals({ goals: [{ ...ANSWER.goals[0], balance: 'abc' }] })).toThrow(/not a number/);
  });

  it('loads GET /api/goals', async () => {
    const asked: string[] = [];
    const get = (async (path: string) => { asked.push(path); return ANSWER; }) as Getter;
    expect((await loadGoals(get)).map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(asked).toEqual(['/api/goals']);
  });
});

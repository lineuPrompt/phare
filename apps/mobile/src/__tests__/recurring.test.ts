import { describe, it, expect } from 'vitest';
import {
  buildCreateBody,
  buildPatchBody,
  cadencesFor,
  draftForLine,
  draftForNew,
  loadRecurring,
  parseRecurring,
  recurringProblemKey,
  sectionsOf,
  willApplyFromDate,
  type RecurringDraft,
  type RecurringLine,
  type RecurringProblem,
} from '../lib/recurring';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { lookup, type Catalog } from '../i18n/catalog';
import type { Getter } from '../lib/timelineLoader';

const TODAY = '2026-10-23';

// GET /api/recurring, shaped as the route answers it (joined names included).
const ANSWER = {
  items: [
    { id: 'ri-pay', description: 'Paycheque', amount: '2749.06', type: 'income', cadence: 'biweekly', anchor_date: '2026-10-09', second_day: null, category_id: null, account_id: 'chq', destination_account_id: null, member_id: 'm1', categories: null, accounts: { name: 'Chequing', type: 'chequing' }, destination_accounts: null },
    { id: 'ri-rent', description: 'Rent', amount: 1800, type: 'expense', cadence: 'monthly', anchor_date: '2026-10-01', second_day: null, category_id: 'cat-h', account_id: 'chq', destination_account_id: null, member_id: null, categories: { name: 'Housing' }, accounts: { name: 'Chequing', type: 'chequing' }, destination_accounts: null },
    { id: 'ri-gym', description: 'Gym', amount: 45, type: 'expense', cadence: 'monthly', anchor_date: null, second_day: null, category_id: 'cat-h', account_id: 'chq', destination_account_id: null, member_id: null, categories: { name: 'Housing' }, accounts: { name: 'Chequing', type: 'chequing' }, destination_accounts: null },
    { id: 'ri-save', description: 'Trip', amount: 100, type: 'transfer', cadence: 'semimonthly', anchor_date: '2026-10-15', second_day: 30, category_id: null, account_id: 'chq', destination_account_id: 'sav', member_id: 'm1', categories: null, accounts: { name: 'Chequing', type: 'chequing' }, destination_accounts: { name: 'Europe trip' } },
  ],
  accounts: [{ id: 'chq', name: 'Chequing', type: 'chequing' }],
  goalAccounts: [{ id: 'sav', name: 'Europe trip', type: 'savings' }],
  categories: [{ id: 'cat-h', name: 'Housing' }],
};

const data = parseRecurring(ANSWER, TODAY);
const line = (id: string) => data.lines.find((l) => l.id === id) as RecurringLine;

describe('reading the list', () => {
  it('reads every line, numerics sent as text included, with the joined names', () => {
    expect(line('ri-pay')).toEqual({
      id: 'ri-pay', description: 'Paycheque', amount: 2749.06, type: 'income', cadence: 'biweekly',
      anchorDate: '2026-10-09', secondDay: null, categoryId: null, categoryName: null,
      accountId: 'chq', accountName: 'Chequing', destinationId: null, destinationName: null,
    });
    expect(line('ri-save')).toMatchObject({ destinationName: 'Europe trip', secondDay: 30 });
    expect(data.goalAccounts).toEqual([{ id: 'sav', name: 'Europe trip' }]);
  });

  it('an answer with no list, an unreadable amount or an unknown type is an error, never an empty list', () => {
    expect(() => parseRecurring({ error: 'x' }, TODAY)).toThrow(/no list/);
    expect(() => parseRecurring({ ...ANSWER, items: [{ ...ANSWER.items[0], amount: 'abc' }] }, TODAY)).toThrow(/not a number/);
    expect(() => parseRecurring({ ...ANSWER, items: [{ ...ANSWER.items[0], type: 'gift' }] }, TODAY)).toThrow(/unknown type/);
    expect(() => parseRecurring({ ...ANSWER, items: [{ ...ANSWER.items[0], cadence: 'daily' }] }, TODAY)).toThrow(/unknown frequency/);
  });

  it("loads with the household's today", async () => {
    const asked: string[] = [];
    const get = (async (path: string) => {
      asked.push(path);
      return path === '/api/household/timezone' ? { timezone: 'America/Toronto' } : ANSWER;
    }) as Getter;
    const loaded = await loadRecurring(get, () => new Date('2026-10-24T01:30:00Z')); // 21:30 in Toronto, still the 23rd
    expect(loaded.today).toBe('2026-10-23');
    expect(asked.sort()).toEqual(['/api/household/timezone', '/api/recurring']);
  });

  it('lines without a date come first; the rest by type', () => {
    const s = sectionsOf(data.lines);
    expect(s.needsDate.map((l) => l.id)).toEqual(['ri-gym']);
    expect(s.income.map((l) => l.id)).toEqual(['ri-pay']);
    expect(s.bills.map((l) => l.id)).toEqual(['ri-rent']);
    expect(s.contributions.map((l) => l.id)).toEqual(['ri-save']);
  });

  it('weekly is offered for contributions only, as on the web', () => {
    expect(cadencesFor('transfer')).toContain('weekly');
    expect(cadencesFor('income')).not.toContain('weekly');
    expect(cadencesFor('expense')).not.toContain('weekly');
  });
});

describe('editing — when the change applies from a date', () => {
  const rent = () => draftForLine(line('ri-rent'), TODAY);

  it('opens with the line as it is, and "applies from" on the 1st of next month', () => {
    expect(rent()).toMatchObject({ amount: '1800', cadence: 'monthly', anchorDate: '2026-10-01', categoryId: 'cat-h', effectiveFrom: '2026-11-01' });
  });

  it.each<[string, Partial<RecurringDraft>, boolean]>([
    ['nothing changed', {}, false],
    ['a description fix', { description: 'Rent (new lease)' }, false],
    ['a category or account fix', { categoryId: 'other' }, false],
    ['a raise', { amount: '1850' }, true],
    ['the same amount typed with a comma', { amount: '1800,00' }, false],
    ['a new frequency', { cadence: 'biweekly' }, true],
    ['a new day of the month', { anchorDate: '2026-10-05' }, true],
    ['the same day in another month (monthly reads only the day)', { anchorDate: '2026-11-01' }, false],
  ])('%s → applies from a date: %s', (_label, patch, expected) => {
    expect(willApplyFromDate(line('ri-rent'), { ...rent(), ...patch })).toBe(expected);
  });

  it('a biweekly line moved by two weeks is a schedule change (it reads the exact date)', () => {
    expect(willApplyFromDate(line('ri-pay'), { ...draftForLine(line('ri-pay'), TODAY), anchorDate: '2026-10-23' })).toBe(true);
  });

  it('twice a month: a new second day is a change', () => {
    const d = draftForLine(line('ri-save'), TODAY);
    expect(willApplyFromDate(line('ri-save'), d)).toBe(false);
    expect(willApplyFromDate(line('ri-save'), { ...d, secondDay: '28' })).toBe(true);
  });

  it('an undated line never applies from a date: adding its date edits it in place', () => {
    const gym = line('ri-gym');
    expect(willApplyFromDate(gym, { ...draftForLine(gym, TODAY), anchorDate: '2026-11-05', amount: '50' })).toBe(false);
  });
});

describe('the PATCH body', () => {
  it('a raise sends the new amount and when it applies from', () => {
    const built = buildPatchBody(line('ri-rent'), { ...draftForLine(line('ri-rent'), TODAY), amount: '1850,50', effectiveFrom: '2026-12-01' }, TODAY);
    expect(built).toEqual({
      ok: true,
      body: {
        description: 'Rent', amount: 1850.5, cadence: 'monthly', anchorDate: '2026-10-01', secondDay: null,
        accountId: 'chq', categoryId: 'cat-h', effectiveFrom: '2026-12-01',
      },
    });
  });

  it('a description fix sends no effective date', () => {
    const built = buildPatchBody(line('ri-rent'), { ...draftForLine(line('ri-rent'), TODAY), description: 'Loyer' }, TODAY);
    expect(built.ok && 'effectiveFrom' in built.body).toBe(false);
  });

  it('dating an undated line sends its date', () => {
    const built = buildPatchBody(line('ri-gym'), { ...draftForLine(line('ri-gym'), TODAY), anchorDate: '2026-11-05' }, TODAY);
    expect(built.ok && built.body.anchorDate).toBe('2026-11-05');
  });

  it('a contribution sends its goal, not an account or category', () => {
    const built = buildPatchBody(line('ri-save'), draftForLine(line('ri-save'), TODAY), TODAY);
    expect(built.ok && built.body).toMatchObject({ destinationAccountId: 'sav', secondDay: 30 });
    expect(built.ok && ('accountId' in built.body || 'categoryId' in built.body)).toBe(false);
  });

  it('income sends a null category — even if the draft somehow holds one (a legacy row)', () => {
    const built = buildPatchBody(line('ri-pay'), draftForLine(line('ri-pay'), TODAY), TODAY);
    expect(built.ok && built.body.categoryId).toBeNull();
    const legacy = buildPatchBody(line('ri-pay'), { ...draftForLine(line('ri-pay'), TODAY), categoryId: 'cat-h' }, TODAY);
    expect(legacy.ok && legacy.body.categoryId).toBeNull();
  });

  it.each<[Partial<RecurringDraft>, RecurringProblem]>([
    [{ amount: '1850', effectiveFrom: '2026-10-22' }, 'effectiveFromPast'],
    [{ amount: '1850', effectiveFrom: '2026-02-30' }, 'effectiveFromInvalid'],
    [{ amount: '1850', effectiveFrom: '' }, 'effectiveFromInvalid'],
    [{ anchorDate: '' }, 'dateRequired'],
    [{ anchorDate: '2026-13-01' }, 'dateInvalid'],
    [{ description: '  ' }, 'descriptionRequired'],
    [{ description: 'x'.repeat(201) }, 'descriptionTooLong'],
    [{ amount: '0' }, 'amountInvalid'],
    [{ amount: '1.005' }, 'amountInvalid'],
    [{ categoryId: '' }, 'categoryRequired'],
    [{ accountId: '' }, 'accountRequired'],
  ])('%j is refused as %s', (patch, problem) => {
    expect(buildPatchBody(line('ri-rent'), { ...draftForLine(line('ri-rent'), TODAY), ...patch }, TODAY)).toEqual({ ok: false, problem });
  });

  it('today itself is a valid "applies from"', () => {
    const built = buildPatchBody(line('ri-rent'), { ...draftForLine(line('ri-rent'), TODAY), amount: '1850', effectiveFrom: TODAY }, TODAY);
    expect(built.ok && built.body.effectiveFrom).toBe(TODAY);
  });

  it('twice a month needs a second day of 1–31', () => {
    const d = draftForLine(line('ri-save'), TODAY);
    expect(buildPatchBody(line('ri-save'), { ...d, secondDay: '32' }, TODAY)).toEqual({ ok: false, problem: 'secondDayInvalid' });
    expect(buildPatchBody(line('ri-save'), { ...d, secondDay: '' }, TODAY)).toEqual({ ok: false, problem: 'secondDayInvalid' });
  });
});

describe('a new line', () => {
  it('a new bill sends type, category and account, and needs a date', () => {
    const d = { ...draftForNew('expense', data), description: 'Phone', amount: '60', anchorDate: '2026-11-03', categoryId: 'cat-h' };
    expect(buildCreateBody(d)).toEqual({
      ok: true,
      body: { description: 'Phone', amount: 60, type: 'expense', cadence: 'monthly', anchorDate: '2026-11-03', secondDay: null, categoryId: 'cat-h', accountId: 'chq' },
    });
    expect(buildCreateBody({ ...d, anchorDate: '' })).toEqual({ ok: false, problem: 'dateRequired' });
  });

  it('a new income sends no category', () => {
    const built = buildCreateBody({ ...draftForNew('income', data), description: 'Side job', amount: '400', anchorDate: '2026-11-07' });
    expect(built.ok && 'categoryId' in built.body).toBe(false);
  });

  it('a new contribution opens on the first goal and sends it', () => {
    const d = draftForNew('transfer', data);
    expect(d.destinationId).toBe('sav');
    const built = buildCreateBody({ ...d, description: 'Trip', amount: '50', anchorDate: '2026-11-01' });
    expect(built.ok && built.body).toMatchObject({ type: 'transfer', destinationAccountId: 'sav' });
    expect(buildCreateBody({ ...d, destinationId: '', description: 'x', amount: '5', anchorDate: '2026-11-01' })).toEqual({ ok: false, problem: 'goalRequired' });
  });
});

describe('messages', () => {
  it('every problem has its message in both languages', () => {
    const problems: RecurringProblem[] = ['descriptionRequired', 'descriptionTooLong', 'amountInvalid', 'dateRequired', 'dateInvalid', 'secondDayInvalid', 'categoryRequired', 'accountRequired', 'goalRequired', 'effectiveFromInvalid', 'effectiveFromPast'];
    for (const catalog of [en, fr] as Catalog[]) {
      for (const p of problems) expect(lookup(catalog, recurringProblemKey(p)), p).toBeTruthy();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { monthlyEquivalent, openingAnchorValue } from '@phare/core';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { lookup, type Catalog } from '../i18n/catalog';
import { ApiError } from '../lib/apiErrors';
import {
  buildForm,
  createOnboardingRunner,
  emptyLine,
  formProblemKey,
  normaliseOpeningBalance,
  onboardingErrorKey,
  payDateBody,
  resolveCardNames,
  type DraftLine,
  type FormProblem,
  type PayDateItem,
} from '../lib/onboardingFlow';
import type { Getter } from '../lib/timelineLoader';

const line = (label: string, amount: string, frequency: DraftLine['frequency'] = 'monthly'): DraftLine => ({
  label, amount, frequency,
});

// ── The form ────────────────────────────────────────────────────────────────

describe('buildForm — every amount read exactly, every half-line refused', () => {
  it('reads an fr-CA decimal comma as cents, not as a stop', () => {
    const r = buildForm([line('Salaire', '2500,50', 'biweekly')], [], '');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [inc] = r.value.calculated.income.lines;
    expect(inc.rawAmount).toBe(2500.5);
    expect(inc.amount).toBe(monthlyEquivalent(2500.5, 'biweekly'));
  });

  it('ignores a line left entirely blank', () => {
    const r = buildForm([line('Salary', '4000'), emptyLine()], [emptyLine()], '');
    expect(r.ok && r.value.calculated.income.lines).toHaveLength(1);
    expect(r.ok && r.value.calculated.expenses.lines).toHaveLength(0);
  });

  it.each<[DraftLine[], DraftLine[], FormProblem]>([
    [[line('', '4000')], [], { kind: 'labelMissing', section: 'income', index: 0 }],
    [[line('Salary', '4000')], [emptyLine(), line('', '1200')], { kind: 'labelMissing', section: 'expenses', index: 1 }],
    [[line('Salary', '')], [], { kind: 'amountInvalid', section: 'income', index: 0 }],
    [[line('Salary', '1 234,56')], [], { kind: 'amountInvalid', section: 'income', index: 0 }],
    [[line('Salary', '0')], [], { kind: 'amountInvalid', section: 'income', index: 0 }],
    [[line('Salary', '4000')], [line('Rent', '12.345')], { kind: 'amountInvalid', section: 'expenses', index: 0 }],
    [[emptyLine()], [line('Rent', '1200')], { kind: 'noIncome' }],
  ])('refuses %j / %j', (income, expenses, problem) => {
    expect(buildForm(income, expenses, '')).toEqual({ ok: false, problem });
  });

  it('refuses a stated income it cannot read, and accepts blank as "not given"', () => {
    expect(buildForm([line('Salary', '4000')], [], 'lots')).toEqual({ ok: false, problem: { kind: 'statedInvalid' } });
    expect(buildForm([line('Salary', '4000')], [], '  ').ok).toBe(true);
  });

  it('feeds the stated income to the guard, read exactly', () => {
    // 4000/month is 48,000/year; 134 000 stated → under 60%: prong (a).
    const r = buildForm([line('Salary', '4000')], [], '134000');
    expect(r.ok && r.value.guard).toEqual({
      ok: false,
      issues: [{ prong: 'income_vs_stated', statedAnnual: 134000, computedAnnual: 48000 }],
    });
  });

  it('passes a believable plan straight through the guard', () => {
    const r = buildForm([line('Salary', '4000')], [line('Rent', '1500')], '');
    expect(r.ok && r.value.guard).toEqual({ ok: true });
  });
});

describe('resolveCardNames', () => {
  it('uses typed names, the localised default for blanks, and only as many as asked', () => {
    expect(resolveCardNames(2, ['  Visa ', '', 'ignored'], (n) => `Carte ${n}`)).toEqual(['Visa', 'Carte 2']);
    expect(resolveCardNames(0, ['Visa'], (n) => `Card ${n}`)).toEqual([]);
  });
});

describe('normaliseOpeningBalance — so the silent skip is unreachable', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['1250,50', '1250.5'],
    ['-40', '-40'],
    ['0', '0'],
  ])('%j → %j', (raw, value) => {
    expect(normaliseOpeningBalance(raw)).toEqual({ ok: true, value });
  });

  it('what it produces is exactly what openingAnchorValue reads', () => {
    const r = normaliseOpeningBalance('1250,50');
    expect(r.ok && openingAnchorValue(r.value)).toBe(1250.5);
  });

  it.each(['abc', '1 250,50', '12.345'])('refuses %j visibly', (raw) => {
    expect(normaliseOpeningBalance(raw)).toEqual({ ok: false });
  });
});

// ── The runner ──────────────────────────────────────────────────────────────

type Sent = { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown };

function fakeServer(responses: Record<string, unknown>) {
  const sent: Sent[] = [];
  const answer = (path: string) => {
    if (!(path in responses)) throw new Error(`unexpected ${path}`);
    const v = responses[path];
    if (v instanceof Error) throw v;
    return v;
  };
  const get = (async (path: string) => {
    sent.push({ method: 'GET', path });
    return answer(path);
  }) as Getter;
  const post = async <T,>(path: string, body: unknown) => {
    sent.push({ method: 'POST', path, body });
    return answer(path) as T;
  };
  const patch = async <T,>(path: string, body: unknown) => {
    sent.push({ method: 'PATCH', path, body });
    return answer(path) as T;
  };
  return { sent, runner: createOnboardingRunner({ get, post, patch, locale: 'fr' }) };
}

const CALC = buildForm([line('Salaire', '4000')], [], '');
const calculated = CALC.ok ? CALC.value.calculated : (null as never);
const PLAN = { monthlyBudget: { totalIncome: 4000 } };
const NOON_TORONTO = () => new Date('2026-10-01T02:30:00Z'); // 30 Sept, 22:30 in Toronto

describe('runner.buildPlan — one call, never a loop', () => {
  it('posts the calculated body once, with the locale', async () => {
    const s = fakeServer({ '/api/plan': { plan: PLAN } });
    expect(await s.runner.buildPlan(calculated)).toEqual(PLAN);
    expect(s.sent).toEqual([{ method: 'POST', path: '/api/plan', body: { source: 'calculated', calculated, locale: 'fr' } }]);
  });

  it('propagates a failure after exactly one request', async () => {
    const s = fakeServer({ '/api/plan': new ApiError('server', 503, 'AI_UNAVAILABLE') });
    await expect(s.runner.buildPlan(calculated)).rejects.toBeInstanceOf(ApiError);
    expect(s.runner.planRequests).toBe(1);
    expect(s.sent).toHaveLength(1);
  });

  it('refuses an answer with no plan in it', async () => {
    const s = fakeServer({ '/api/plan': {} });
    await expect(s.runner.buildPlan(calculated)).rejects.toThrow('without a plan');
  });
});

describe('runner.review — its failure never stops the save', () => {
  it('returns the letter', async () => {
    const s = fakeServer({ '/api/review-stream?stream=0': { review: 'Bonjour.' } });
    expect(await s.runner.review(PLAN)).toEqual({ ok: true, text: 'Bonjour.' });
    expect(s.sent[0].body).toEqual({ plan: PLAN, analysis: { source: 'calculated' }, locale: 'fr' });
  });

  it.each<[unknown, string, string | null]>([
    [new ApiError('server', 413, 'PAYLOAD_TOO_LARGE'), 'onboarding.plan.reviewTooLarge', null],
    [new ApiError('rateLimited', 429, 'ONBOARDING_QUOTA_EXHAUSTED', '2026-10-01'), 'onboarding.errors.onboardingQuotaExhausted', '2026-10-01'],
    [new ApiError('unauthorized', 401, 'NOT_AUTHENTICATED'), 'onboarding.errors.notAuthenticated', null],
    [new ApiError('server', 500, null), 'onboarding.plan.reviewError', null],
    [{ review: '   ' }, 'onboarding.plan.reviewError', null],
  ])('%s → %s', async (response, messageKey, resetsOn) => {
    const s = fakeServer({ '/api/review-stream?stream=0': response });
    expect(await s.runner.review(PLAN)).toEqual({ ok: false, messageKey, resetsOn });
  });
});

describe('runner.save — confirmReplace is never true', () => {
  it('sends the plan untouched, confirmReplace false, no file', async () => {
    const s = fakeServer({ '/api/save-plan': { saved: true, needsPayDate: [] } });
    const out = await s.runner.save(PLAN, 'Lettre', ['Visa']);
    expect(out.kind).toBe('done');
    expect(s.sent[0].body).toEqual({
      plan: PLAN, reviewText: 'Lettre', locale: 'fr', cardNames: ['Visa'], fileMeta: null, confirmReplace: false,
    });
  });
});

const ITEM: PayDateItem = { id: 'rec-1', description: 'Paie', cadence: 'biweekly', amount: 2000, type: 'income' };

describe('runner.afterSave — anchor only after a real save', () => {
  it('needsConfirmation: nothing was written, so nothing is anchored', async () => {
    const s = fakeServer({});
    const next = await s.runner.afterSave({ kind: 'needsConfirmation', counts: { totalRecurring: 3 } }, '1250.5');
    expect(next).toEqual({ kind: 'needsConfirmation' });
    expect(s.sent).toEqual([]);
  });

  it('a save anchors chequing at the household’s today, then asks for pay dates', async () => {
    const s = fakeServer({
      '/api/accounts': { accounts: [{ id: 'sav', name: 'S', type: 'savings' }, { id: 'chq', name: 'C', type: 'chequing' }] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors': { ok: true },
    });
    const next = await s.runner.afterSave(
      { kind: 'needsPayDate', needsPayDate: [ITEM], unmatchedMembers: [], householdMembers: [] },
      '1250.5',
      NOON_TORONTO
    );
    expect(next).toEqual({ kind: 'payDates', items: [ITEM], anchor: 'anchored' });
    expect(s.sent.find((x) => x.path === '/api/anchors')?.body).toEqual({
      accountId: 'chq', anchorDate: '2026-09-30', balance: 1250.5,
    });
  });

  it('a blank balance anchors nothing and asks nothing', async () => {
    const s = fakeServer({});
    const next = await s.runner.afterSave(
      { kind: 'done', needsPayDate: [], unmatchedMembers: [], householdMembers: [] },
      ''
    );
    expect(next).toEqual({ kind: 'done', anchor: 'skipped' });
    expect(s.sent).toEqual([]);
  });

  it('a failed anchor is reported as failed, not dropped', async () => {
    const s = fakeServer({
      '/api/accounts': { accounts: [{ id: 'chq', name: 'C', type: 'chequing' }] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors': new ApiError('server', 400, null),
    });
    const next = await s.runner.afterSave(
      { kind: 'done', needsPayDate: [], unmatchedMembers: [], householdMembers: [] },
      '100'
    );
    expect(next).toEqual({ kind: 'done', anchor: 'failed' });
  });

  it('no chequing account is a failed anchor', async () => {
    const s = fakeServer({
      '/api/accounts': { accounts: [] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
    });
    expect(await s.runner.anchor('100')).toBe('failed');
  });
});

describe('pay dates', () => {
  const TODAY = '2026-09-27';

  it('a biweekly date inside the window is patched with no memberId key', async () => {
    const s = fakeServer({ '/api/recurring/rec-1': { ok: true } });
    const r = await s.runner.savePayDate(ITEM, { nextPayDate: '2026-10-09', day1: '', day2: '' }, TODAY);
    expect(r).toEqual({ ok: true });
    expect(s.sent).toEqual([
      { method: 'PATCH', path: '/api/recurring/rec-1', body: { anchorDate: '2026-10-09', secondDay: null } },
    ]);
    expect('memberId' in (s.sent[0].body as object)).toBe(false);
  });

  it.each<[Partial<PayDateItem>, { nextPayDate: string; day1: string; day2: string }, string, Record<string, number> | undefined]>([
    [{}, { nextPayDate: '2026-09-26', day1: '', day2: '' }, 'onboarding.payDates.error.past', { days: 14 }],
    [{}, { nextPayDate: '2026-10-12', day1: '', day2: '' }, 'onboarding.payDates.error.tooFar', { days: 14 }],
    [{ cadence: 'weekly' }, { nextPayDate: '2026-10-05', day1: '', day2: '' }, 'onboarding.payDates.error.tooFar', { days: 7 }],
    [{}, { nextPayDate: '2026-02-31', day1: '', day2: '' }, 'onboarding.payDates.error.date', undefined],
    [{ cadence: 'semimonthly' }, { nextPayDate: '', day1: '', day2: '15' }, 'onboarding.payDates.error.range', undefined],
    [{ cadence: 'semimonthly' }, { nextPayDate: '', day1: '1.5', day2: '15' }, 'onboarding.payDates.error.range', undefined],
    [{ cadence: 'semimonthly' }, { nextPayDate: '', day1: '15', day2: '15' }, 'onboarding.payDates.error.same', undefined],
    [{ cadence: 'monthly' }, { nextPayDate: '2026-10-01', day1: '', day2: '' }, 'onboarding.payDates.error.cadence', undefined],
  ])('%j %j → %s, nothing sent', async (patch, input, messageKey, values) => {
    const s = fakeServer({});
    const r = await s.runner.savePayDate({ ...ITEM, ...patch }, input, TODAY);
    expect(r).toEqual(values ? { ok: false, messageKey, values } : { ok: false, messageKey });
    expect(s.sent).toEqual([]);
  });

  it('semimonthly builds the anchor in the household’s current month', () => {
    expect(payDateBody({ ...ITEM, cadence: 'semimonthly' }, { nextPayDate: '', day1: '15', day2: '1' }, TODAY)).toEqual({
      ok: true, body: { anchorDate: '2026-09-01', secondDay: 15 },
    });
  });
});

// ── Messages ────────────────────────────────────────────────────────────────

describe('onboardingErrorKey', () => {
  it.each([
    ['PAYLOAD_TOO_LARGE', 'onboarding.errors.payloadTooLarge'],
    ['AI_UNAVAILABLE', 'onboarding.errors.aiUnavailable'],
    ['RATE_LIMITED', 'onboarding.errors.rateLimited'],
    ['NOT_AUTHENTICATED', 'onboarding.errors.notAuthenticated'],
    ['ONBOARDING_QUOTA_EXHAUSTED', 'onboarding.errors.onboardingQuotaExhausted'],
    ['PLAN_FAILED', 'onboarding.errors.planFailed'],
    ['INVALID_JSON', 'onboarding.errors.planFailed'],
  ])('%s → %s', (code, key) => {
    expect(onboardingErrorKey(new ApiError('server', 400, code))).toBe(key);
  });

  it('falls back to the status message for an unknown code or a network failure', () => {
    expect(onboardingErrorKey(new ApiError('server', 500, 'NEW_THING'))).toBe('errors.server');
    expect(onboardingErrorKey(new ApiError('network', null, null))).toBe('errors.network');
  });
});

// Keys built at runtime are invisible to the parity test's t('literal')
// extractor. Every one of them is resolved here, in both locales.
const RUNTIME_KEYS = [
  ...(['noIncome', 'labelMissing', 'amountInvalid', 'statedInvalid'] as const).map((kind) =>
    formProblemKey({ kind, section: 'income', index: 0 } as FormProblem)
  ),
  ...['PAYLOAD_TOO_LARGE', 'AI_UNAVAILABLE', 'RATE_LIMITED', 'NOT_AUTHENTICATED', 'ONBOARDING_QUOTA_EXHAUSTED', 'PLAN_FAILED'].map(
    (code) => onboardingErrorKey(new ApiError('server', 400, code))
  ),
  ...['past', 'tooFar', 'range', 'same', 'date', 'cadence'].map((e) => `onboarding.payDates.error.${e}`),
  'onboarding.plan.reviewError',
  'onboarding.plan.reviewTooLarge',
];

describe('every runtime onboarding key resolves in both locales', () => {
  it.each(['en', 'fr'])('%s', (locale) => {
    const catalog = (locale === 'en' ? en : fr) as Catalog;
    const missing = RUNTIME_KEYS.filter((k) => !lookup(catalog, k));
    expect(missing).toEqual([]);
    expect(RUNTIME_KEYS.length).toBe(18);
  });
});

import { describe, it, expect } from 'vitest';
import { parseExpenseRequest, EXPENSE_MAX_BODY_BYTES } from '../expenseRequest';
import {
  MANUAL_ENTRY_DESCRIPTION_MAX_CHARS,
  MANUAL_ENTRY_MAX_AMOUNT,
  MANUAL_ENTRY_MAX_INSTALLMENTS,
} from '@phare/core';

const CAT = '11111111-1111-4111-8111-111111111111';
const ACCT = '22222222-2222-4222-8222-222222222222';

const VALID = {
  type: 'expense',
  date: '2026-09-27',
  description: 'Groceries',
  categoryId: CAT,
  amount: 12.5,
  accountId: ACCT,
};

function parse(body: unknown) {
  return parseExpenseRequest(JSON.stringify(body));
}

function codeOf(body: unknown): string | null {
  const r = parse(body);
  return r.ok ? null : r.refusal.code;
}

describe('parseExpenseRequest — a valid body', () => {
  it('passes a complete expense through unchanged', () => {
    const r = parse(VALID);
    expect(r).toEqual({
      ok: true,
      value: {
        type: 'expense', date: '2026-09-27', description: 'Groceries', amount: 12.5,
        categoryId: CAT, accountId: ACCT, repeat: 'once', installments: null,
      },
    });
  });

  it('defaults a missing type to expense, as the route always has', () => {
    const { type: _omit, ...noType } = VALID;
    const r = parse(noType);
    expect(r.ok && r.value.type).toBe('expense');
  });

  it('accepts income with no category', () => {
    expect(codeOf({ ...VALID, type: 'income', categoryId: undefined })).toBeNull();
  });

  it('treats an empty categoryId or accountId as none', () => {
    const r = parse({ ...VALID, type: 'income', categoryId: '', accountId: '' });
    expect(r.ok && [r.value.categoryId, r.value.accountId]).toEqual([null, null]);
  });

  it('keeps the description exactly as sent: never trimmed, never cut', () => {
    const r = parse({ ...VALID, description: '  Café du coin  ' });
    expect(r.ok && r.value.description).toBe('  Café du coin  ');
  });
});

describe('the body itself', () => {
  it('refuses a body over the byte cap, before parsing it', () => {
    const raw = JSON.stringify({ ...VALID, pad: 'x'.repeat(EXPENSE_MAX_BODY_BYTES) });
    const r = parseExpenseRequest(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && [r.refusal.code, r.refusal.status]).toEqual(['PAYLOAD_TOO_LARGE', 413]);
  });

  it('counts bytes, not characters: accented text is weighed as UTF-8', () => {
    // 'é' is two bytes. Half the cap in 'é' plus the JSON around it is over.
    const raw = JSON.stringify({ ...VALID, pad: 'é'.repeat(EXPENSE_MAX_BODY_BYTES / 2) });
    expect(raw.length).toBeLessThan(EXPENSE_MAX_BODY_BYTES + 200);
    const r = parseExpenseRequest(raw);
    expect(!r.ok && r.refusal.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses text that is not JSON', () => {
    expect(parseExpenseRequest('not json').ok).toBe(false);
    const r = parseExpenseRequest('not json');
    expect(!r.ok && r.refusal.code).toBe('INVALID_JSON');
  });

  it.each([['[]'], ['null'], ['42'], ['"s"']])('refuses a JSON value that is not an object: %s', (raw) => {
    const r = parseExpenseRequest(raw);
    expect(!r.ok && r.refusal.code).toBe('INVALID_JSON');
  });
});

describe('type', () => {
  it.each(['transfer', 'EXPENSE', 1])('refuses %j', (type) => {
    expect(codeOf({ ...VALID, type })).toBe('INVALID_TYPE');
  });
});

describe('date', () => {
  it.each(['2026-02-31', '2026-9-27', '27/09/2026', '', 20260927, null])('refuses %j', (date) => {
    expect(codeOf({ ...VALID, date })).toBe('INVALID_DATE');
  });

  it('refuses a missing date', () => {
    const { date: _omit, ...noDate } = VALID;
    expect(codeOf(noDate)).toBe('INVALID_DATE');
  });
});

describe('description — required, bounded, rejected not truncated', () => {
  it.each(['', '   ', null, 42])('refuses %j as missing', (description) => {
    expect(codeOf({ ...VALID, description })).toBe('DESCRIPTION_REQUIRED');
  });

  it('accepts exactly the limit', () => {
    expect(codeOf({ ...VALID, description: 'a'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) })).toBeNull();
  });

  it('refuses one character over, and says how long it was', () => {
    const r = parse({ ...VALID, description: 'a'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS + 1) });
    expect(!r.ok && r.refusal.code).toBe('DESCRIPTION_TOO_LONG');
    expect(!r.ok && r.refusal.error).toContain(String(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS + 1));
  });
});

describe('amount — finite, above zero, bounded, cents at most', () => {
  it.each<[unknown, string]>([
    [0, 'zero'],
    [-12.5, 'negative (was saved as-is before this guard)'],
    ['12.50', 'a string'],
    [null, 'null'],
    [12.345, 'a third decimal'],
    [MANUAL_ENTRY_MAX_AMOUNT + 0.01, 'one cent over the ceiling'],
  ])('refuses %j (%s)', (amount) => {
    expect(codeOf({ ...VALID, amount })).toBe('INVALID_AMOUNT');
  });

  it('refuses a missing amount', () => {
    const { amount: _omit, ...noAmount } = VALID;
    expect(codeOf(noAmount)).toBe('INVALID_AMOUNT');
  });

  it('refuses non-finite numbers, which JSON can only carry as null — so test the parsed path too', () => {
    // JSON.stringify(Infinity) is "null"; a raw body can still say 1e999.
    const r = parseExpenseRequest(JSON.stringify(VALID).replace('"amount":12.5', '"amount":1e999'));
    expect(!r.ok && r.refusal.code).toBe('INVALID_AMOUNT');
  });

  it.each([0.01, 12.1, 19.99, 1234.56, MANUAL_ENTRY_MAX_AMOUNT])('accepts %j', (amount) => {
    expect(codeOf({ ...VALID, amount })).toBeNull();
  });

  it('accepts cents that float arithmetic cannot represent exactly', () => {
    // 0.29 * 100 is 28.999999999999996 in IEEE 754.
    expect(codeOf({ ...VALID, amount: 0.29 })).toBeNull();
  });
});

describe('category', () => {
  it('is required for money out', () => {
    expect(codeOf({ ...VALID, categoryId: undefined })).toBe('CATEGORY_REQUIRED');
    expect(codeOf({ ...VALID, categoryId: '' })).toBe('CATEGORY_REQUIRED');
  });

  it.each(['cat-groceries', 42, { id: CAT }])('refuses a malformed id %j as not found', (categoryId) => {
    expect(codeOf({ ...VALID, categoryId })).toBe('CATEGORY_NOT_FOUND');
  });
});

describe('account', () => {
  it('is optional — the route falls back to chequing', () => {
    const { accountId: _omit, ...noAccount } = VALID;
    const r = parse(noAccount);
    expect(r.ok && r.value.accountId).toBeNull();
  });

  it.each(['chq-1', 42, [ACCT]])('refuses a malformed id %j as not found', (accountId) => {
    expect(codeOf({ ...VALID, accountId })).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('installments — bounded', () => {
  it.each<[unknown, string]>([
    [1, 'one payment is not a plan (was silently a single row)'],
    [MANUAL_ENTRY_MAX_INSTALLMENTS + 1, 'one past the maximum'],
    [100000, 'the 100,000-row request'],
    [2.5, 'a fraction'],
    ['12', 'a string'],
    [null, 'missing'],
  ])('refuses %j (%s)', (installments) => {
    expect(codeOf({ ...VALID, repeat: 'installments', installments })).toBe('INVALID_INSTALLMENTS');
  });

  it.each([2, 12, MANUAL_ENTRY_MAX_INSTALLMENTS])('accepts %j', (installments) => {
    const r = parse({ ...VALID, repeat: 'installments', installments });
    expect(r.ok && r.value.installments).toBe(installments);
  });

  it('ignores installments unless the repeat mode asks for them', () => {
    const r = parse({ ...VALID, repeat: 'once', installments: 100000 });
    expect(r.ok && [r.value.repeat, r.value.installments]).toEqual(['once', null]);
  });

  it('reads monthly as monthly, and anything unrecognised as once', () => {
    expect(parse({ ...VALID, repeat: 'monthly' })).toMatchObject({ ok: true, value: { repeat: 'monthly' } });
    expect(parse({ ...VALID, repeat: 'weekly' })).toMatchObject({ ok: true, value: { repeat: 'once' } });
  });
});

describe('every refusal carries a code and prose', () => {
  it.each([
    ['not json'],
    [JSON.stringify({ ...VALID, amount: -1 })],
    [JSON.stringify({ ...VALID, date: 'x' })],
    [JSON.stringify({ ...VALID, repeat: 'installments', installments: 0 })],
  ])('%s', (raw) => {
    const r = parseExpenseRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toMatch(/^[A-Z_]+$/);
      expect(r.refusal.error.length).toBeGreaterThan(0);
      expect(r.refusal.status).toBeGreaterThanOrEqual(400);
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { MANUAL_ENTRY_DESCRIPTION_MAX_CHARS } from '@phare/core';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { lookup, type Catalog } from '../i18n/catalog';
import { ApiError } from '../lib/apiErrors';
import {
  buildExpenseBody,
  entryAccounts,
  entryErrorKey,
  ENTRY_ERROR_KEYS,
  loadEntryForm,
  problemKey,
  type DraftProblem,
  type EntryDraft,
} from '../lib/quickEntry';
import { emitEntrySaved, onEntrySaved } from '../lib/entryEvents';
import type { Getter } from '../lib/timelineLoader';

const CHQ = { id: 'chq', name: 'Chequing', type: 'chequing' };
const VISA = { id: 'visa', name: 'Visa', type: 'credit_card' };
const MC = { id: 'mc', name: 'Mastercard', type: 'credit_card' };
const SAVINGS = { id: 'sav', name: 'Savings', type: 'savings' };
const DEBT = { id: 'loan', name: 'Car loan', type: 'debt' };

const DRAFT: EntryDraft = {
  accountId: 'visa',
  date: '2026-09-27',
  description: 'Groceries',
  categoryId: 'cat-1',
  amount: '12,50',
};

describe('entryAccounts — where money out can go', () => {
  it('offers chequing first, then cards in server order, and nothing else', () => {
    expect(entryAccounts([VISA, SAVINGS, MC, DEBT, CHQ]).map((a) => a.id)).toEqual(['chq', 'visa', 'mc']);
  });
});

describe('loadEntryForm', () => {
  function getter(table: Record<string, unknown>) {
    return (async (path: string) => {
      const value = table[path];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error(`unexpected ${path}`);
      return value;
    }) as Getter;
  }

  it('defaults the date to the household’s today, not UTC’s', async () => {
    const form = await loadEntryForm(
      getter({
        '/api/accounts': { accounts: [CHQ] },
        '/api/categories': { categories: [{ id: 'c', name: 'Groceries' }] },
        '/api/household/timezone': { timezone: 'America/Vancouver' },
      }),
      () => new Date('2026-09-28T05:00:00Z') // 22:00 on the 27th in Vancouver
    );
    expect(form.today).toBe('2026-09-27');
    expect(form.categories).toEqual([{ id: 'c', name: 'Groceries' }]);
  });

  it('propagates a timezone failure rather than guessing the date', async () => {
    await expect(
      loadEntryForm(
        getter({
          '/api/accounts': { accounts: [CHQ] },
          '/api/categories': { categories: [] },
          '/api/household/timezone': new Error('tz down'),
        })
      )
    ).rejects.toThrow('tz down');
  });
});

describe('buildExpenseBody', () => {
  it('builds exactly the V1 body: no member, no repeat, no installments', () => {
    const built = buildExpenseBody(DRAFT);
    expect(built).toEqual({
      ok: true,
      body: {
        type: 'expense',
        date: '2026-09-27',
        description: 'Groceries',
        categoryId: 'cat-1',
        amount: 12.5,
        accountId: 'visa',
      },
    });
    expect(built.ok && Object.keys(built.body).sort()).toEqual(
      ['accountId', 'amount', 'categoryId', 'date', 'description', 'type']
    );
  });

  it('reads the fr-CA keypad comma as cents, never truncating to whole dollars', () => {
    const built = buildExpenseBody({ ...DRAFT, amount: '12,50' });
    expect(built.ok && built.body.amount).toBe(12.5);
  });

  it('trims the description, as the web forms do', () => {
    const built = buildExpenseBody({ ...DRAFT, description: '  Café  ' });
    expect(built.ok && built.body.description).toBe('Café');
  });

  it.each<[Partial<EntryDraft>, DraftProblem]>([
    [{ accountId: '' }, 'accountRequired'],
    [{ date: '2026-02-31' }, 'dateInvalid'],
    [{ date: '' }, 'dateInvalid'],
    [{ description: '   ' }, 'descriptionRequired'],
    [{ description: 'x'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS + 1) }, 'descriptionTooLong'],
    [{ categoryId: '' }, 'categoryRequired'],
    [{ amount: '' }, 'amountInvalid'],
    [{ amount: '0' }, 'amountInvalid'],
    [{ amount: '-5' }, 'amountInvalid'],
    [{ amount: '12.345' }, 'amountInvalid'],
    [{ amount: '12abc' }, 'amountInvalid'],
  ])('%j → %s', (patch, problem) => {
    expect(buildExpenseBody({ ...DRAFT, ...patch })).toEqual({ ok: false, problem });
  });

  it('measures the description after trimming: surrounding spaces do not count', () => {
    const exact = 'x'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS);
    expect(buildExpenseBody({ ...DRAFT, description: `  ${exact}  ` }).ok).toBe(true);
  });
});

// problemKey and ENTRY_ERROR_KEYS produce keys at runtime, which the parity
// test's t('literal') extractor cannot see. These close that gap.
const CATALOGS: Record<string, Catalog> = { en: en as Catalog, fr: fr as Catalog };
const PROBLEMS: DraftProblem[] = [
  'accountRequired', 'dateInvalid', 'descriptionRequired',
  'descriptionTooLong', 'categoryRequired', 'amountInvalid',
];

describe('every runtime message key resolves in both locales', () => {
  it.each(['en', 'fr'])('%s: every problem key', (locale) => {
    for (const problem of PROBLEMS) {
      const value = lookup(CATALOGS[locale], problemKey(problem));
      expect(value, problemKey(problem)).toBeTruthy();
    }
  });

  it.each(['en', 'fr'])('%s: every server-code key', (locale) => {
    for (const key of Object.values(ENTRY_ERROR_KEYS)) {
      expect(lookup(CATALOGS[locale], key), key).toBeTruthy();
    }
  });

  it('problem keys are distinct: no two problems share a message', () => {
    expect(new Set(PROBLEMS.map(problemKey)).size).toBe(PROBLEMS.length);
  });
});

describe('entryErrorKey — the server’s code names the message', () => {
  it('maps a refused account to its own message, not "something went wrong"', () => {
    expect(entryErrorKey(new ApiError('server', 400, 'ACCOUNT_NOT_FOUND'))).toBe('entry.errors.accountNotFound');
  });

  it('maps a refused amount', () => {
    expect(entryErrorKey(new ApiError('server', 400, 'INVALID_AMOUNT'))).toBe('entry.errors.invalidAmount');
  });

  it('falls back to the status message for a code it does not know', () => {
    expect(entryErrorKey(new ApiError('server', 400, 'SOMETHING_NEW'))).toBe('errors.server');
  });

  it('keeps a lost session a lost session', () => {
    expect(entryErrorKey(new ApiError('unauthorized', 401, 'NOT_AUTHENTICATED'))).toBe('errors.unauthorized');
  });

  it('maps a network failure', () => {
    expect(entryErrorKey(new ApiError('network', null, null))).toBe('errors.network');
  });
});

describe('entry-saved signal', () => {
  it('reaches every subscriber, and stops after unsubscribing', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onEntrySaved(a);
    const offB = onEntrySaved(b);
    emitEntrySaved();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    offA();
    emitEntrySaved();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 2]);
    offB();
  });
});

import { describe, it, expect } from 'vitest';
import { MANUAL_ENTRY_DESCRIPTION_MAX_CHARS } from '@phare/core';
import { ApiError } from '../lib/apiErrors';
import { amountField, buildEditBody, editableKind, editErrorKey, editProblemKey, entryPath, type EditDraft } from '../lib/entryEdit';

const draft = (over: Partial<EditDraft> = {}): EditDraft => ({
  date: '2026-10-14', description: 'Groceries', amount: '86,40', categoryId: '', ...over,
});

describe('editableKind — which route a Timeline row takes', () => {
  it('income and expense go through the expense route', () => {
    expect(editableKind({ isBridge: false, type: 'expense' })).toBe('entry');
    expect(editableKind({ isBridge: false, type: 'income' })).toBe('entry');
  });

  it('a transfer goes through the transfer route, which moves both sides', () => {
    expect(editableKind({ isBridge: false, type: 'transfer' })).toBe('transfer');
  });

  it('a card payment is computed and cannot be edited, whatever its type', () => {
    expect(editableKind({ isBridge: true, type: 'transfer' })).toBeNull();
    expect(editableKind({ isBridge: true, type: 'expense' })).toBeNull();
  });
});

describe('entryPath', () => {
  it('names the route for each kind, escaping the id', () => {
    expect(entryPath('entry', 'a b')).toBe('/api/expenses/a%20b');
    expect(entryPath('transfer', 'tx-1')).toBe('/api/transfers/tx-1');
  });
});

describe('buildEditBody', () => {
  it('an expense: date, trimmed description, amount read exactly from a French keypad', () => {
    expect(buildEditBody('entry', 'expense', draft({ description: '  Groceries  ' }))).toEqual({
      ok: true, body: { date: '2026-10-14', description: 'Groceries', amount: 86.4 },
    });
  });

  it('sends a category only when one was picked — "keep current" sends none', () => {
    expect(buildEditBody('entry', 'expense', draft({ categoryId: 'cat-1' }))).toMatchObject({ body: { categoryId: 'cat-1' } });
    const kept = buildEditBody('entry', 'expense', draft());
    expect(kept.ok && 'categoryId' in kept.body).toBe(false);
  });

  it('never sends a category for income', () => {
    const body = buildEditBody('entry', 'income', draft({ categoryId: 'cat-1' }));
    expect(body.ok && 'categoryId' in body.body).toBe(false);
  });

  it('never sends a type: money out stays money out', () => {
    const body = buildEditBody('entry', 'expense', draft());
    expect(body.ok && 'type' in body.body).toBe(false);
  });

  it('a transfer sends exactly date, description and amount', () => {
    expect(buildEditBody('transfer', 'transfer', draft({ categoryId: 'cat-1' }))).toEqual({
      ok: true, body: { date: '2026-10-14', description: 'Groceries', amount: 86.4 },
    });
  });

  it('refuses a date that is not a real calendar date', () => {
    expect(buildEditBody('entry', 'expense', draft({ date: '2026-02-30' }))).toEqual({ ok: false, problem: 'dateInvalid' });
  });

  it('refuses a blank description, and one past quick entry’s limit — never cut', () => {
    expect(buildEditBody('entry', 'expense', draft({ description: '  ' }))).toEqual({ ok: false, problem: 'descriptionRequired' });
    expect(buildEditBody('entry', 'expense', draft({ description: 'x'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS + 1) })))
      .toEqual({ ok: false, problem: 'descriptionTooLong' });
    expect(buildEditBody('entry', 'expense', draft({ description: 'x'.repeat(MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) })).ok).toBe(true);
  });

  it.each(['0', '-5', '', 'abc', '1,234.50'])('refuses the amount %p', (amount) => {
    expect(buildEditBody('entry', 'expense', draft({ amount }))).toEqual({ ok: false, problem: 'amountInvalid' });
  });
});

describe('amountField', () => {
  it('shows a debt draw (stored negative) as its positive size', () => {
    expect(amountField(-250)).toBe('250');
    expect(amountField(86.4)).toBe('86.4');
  });
});

describe('message keys', () => {
  it('a 409 says the entry is gone; anything else uses the shared mapping', () => {
    expect(editErrorKey(new ApiError('server', 409, null))).toBe('edit.errors.gone');
    expect(editErrorKey(new ApiError('network', null, null))).not.toBe('edit.errors.gone');
  });

  it('each problem has its own key', () => {
    expect(editProblemKey('dateInvalid')).toBe('entry.problems.dateInvalid');
    expect(editProblemKey('descriptionRequired')).toBe('entry.problems.descriptionRequired');
    expect(editProblemKey('descriptionTooLong')).toBe('entry.problems.descriptionTooLong');
    expect(editProblemKey('amountInvalid')).toBe('entry.problems.amountInvalid');
  });
});

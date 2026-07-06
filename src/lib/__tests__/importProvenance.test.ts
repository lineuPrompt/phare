import { describe, it, expect } from 'vitest';
import {
  buildFileImportRow,
  resolveTransactionSource,
  needsReplaceConfirmation,
  partitionByProvenance,
  missingSeedCategories,
  planAccountActions,
  type AccountProvenanceInfo,
} from '../importProvenance';

describe('buildFileImportRow', () => {
  it('records the real file name and type for a file upload', () => {
    const row = buildFileImportRow({ fileName: 'budget.xlsx', fileType: 'excel' }, 'hh1', 'user1');
    expect(row).toEqual({
      household_id: 'hh1',
      uploaded_by: 'user1',
      file_name: 'budget.xlsx',
      file_type: 'excel',
      storage_path: null,
      status: 'completed',
    });
  });

  it('falls back to a manual-entry marker when there is no file', () => {
    const row = buildFileImportRow(null, 'hh1', 'user1');
    expect(row.file_name).toBe('Manual entry');
    expect(row.file_type).toBe('manual');
  });

  it('treats undefined the same as null', () => {
    const row = buildFileImportRow(undefined, 'hh1', 'user1');
    expect(row.file_type).toBe('manual');
  });
});

describe('resolveTransactionSource', () => {
  it('reports csv honestly', () => {
    expect(resolveTransactionSource({ fileName: 'a.csv', fileType: 'csv' })).toBe('csv');
  });

  it('reports excel honestly', () => {
    expect(resolveTransactionSource({ fileName: 'a.xlsx', fileType: 'excel' })).toBe('excel');
  });

  it('reports manual when no file was involved', () => {
    expect(resolveTransactionSource(null)).toBe('manual');
    expect(resolveTransactionSource(undefined)).toBe('manual');
  });
});

describe('needsReplaceConfirmation', () => {
  it('does not block a first-time onboarding (no prior data)', () => {
    expect(needsReplaceConfirmation(false, undefined)).toBe(false);
  });

  it('blocks when prior data exists and the user has not confirmed', () => {
    expect(needsReplaceConfirmation(true, undefined)).toBe(true);
    expect(needsReplaceConfirmation(true, false)).toBe(true);
  });

  it('proceeds once the user has explicitly confirmed', () => {
    expect(needsReplaceConfirmation(true, true)).toBe(false);
  });
});

describe('partitionByProvenance', () => {
  it('separates import-derived rows from ad-hoc/legacy rows', () => {
    const rows = [
      { id: '1', file_import_id: 'imp1' },
      { id: '2', file_import_id: null },
      { id: '3', file_import_id: 'imp1' },
      { id: '4', file_import_id: null },
    ];
    const { provenanced, legacy } = partitionByProvenance(rows);
    expect(provenanced.map((r) => r.id)).toEqual(['1', '3']);
    expect(legacy.map((r) => r.id)).toEqual(['2', '4']);
  });

  it('handles an all-legacy household without throwing', () => {
    const rows = [{ id: '1', file_import_id: null }];
    const { provenanced, legacy } = partitionByProvenance(rows);
    expect(provenanced).toEqual([]);
    expect(legacy).toHaveLength(1);
  });
});

describe('missingSeedCategories', () => {
  const seed = ['Housing', 'Transportation', 'Unexpected'];

  it('returns all seed names when the household has none yet', () => {
    expect(missingSeedCategories([], seed)).toEqual(seed);
  });

  it('excludes seed names that already exist, case- and whitespace-insensitive', () => {
    const result = missingSeedCategories([' housing ', 'UNEXPECTED'], seed);
    expect(result).toEqual(['Transportation']);
  });

  it('does not exclude anything based on a user-added custom category', () => {
    const result = missingSeedCategories(['Housing', 'Transportation', 'Unexpected', 'Pet Care'], seed);
    expect(result).toEqual([]);
  });
});

describe('planAccountActions', () => {
  const base: AccountProvenanceInfo = {
    id: 'a1', name: 'Card', type: 'credit_card', file_import_id: 'imp1',
    transactionCount: 0, envelopeItemCount: 0, monthlyGoalCount: 0,
  };

  describe('no desired accounts (baseline delete/preserve behaviour)', () => {
    it('deletes a fresh, untouched card that came from a prior import', () => {
      const { toDelete, toPreserve, toReuse, toCreate } = planAccountActions([], [base]);
      expect(toDelete).toEqual([{ id: 'a1', name: 'Card' }]);
      expect(toPreserve).toEqual([]);
      expect(toReuse).toEqual([]);
      expect(toCreate).toEqual([]);
    });

    it('preserves an account the user added manually (no import provenance at all)', () => {
      const account = { ...base, file_import_id: null };
      const { toDelete, toPreserve } = planAccountActions([], [account]);
      expect(toDelete).toEqual([]);
      expect(toPreserve).toEqual([{ id: 'a1', name: 'Card', reason: 'not_from_import' }]);
    });

    it('preserves an imported card that has manual transactions (including bridge/transfer history)', () => {
      const account = { ...base, transactionCount: 3 };
      const { toPreserve } = planAccountActions([], [account]);
      expect(toPreserve).toEqual([{ id: 'a1', name: 'Card', reason: 'has_transactions' }]);
    });

    it('preserves an imported card that has an envelope sub-budget', () => {
      const account = { ...base, envelopeItemCount: 1 };
      const { toPreserve } = planAccountActions([], [account]);
      expect(toPreserve).toEqual([{ id: 'a1', name: 'Card', reason: 'has_envelope_budget' }]);
    });

    it('preserves an imported card that has a monthly goal set', () => {
      const account = { ...base, monthlyGoalCount: 1 };
      const { toPreserve } = planAccountActions([], [account]);
      expect(toPreserve).toEqual([{ id: 'a1', name: 'Card', reason: 'has_monthly_goal' }]);
    });

    it('partitions a mixed household correctly and preserves list order', () => {
      const accounts: AccountProvenanceInfo[] = [
        { ...base, id: 'fresh', name: 'Fresh Card' },
        { ...base, id: 'used', name: 'Used Card', transactionCount: 5 },
        { ...base, id: 'manual', name: 'Manual Card', file_import_id: null },
      ];
      const { toDelete, toPreserve } = planAccountActions([], accounts);
      expect(toDelete.map((a) => a.id)).toEqual(['fresh']);
      expect(toPreserve.map((a) => a.id)).toEqual(['used', 'manual']);
    });

    it('returns empty plans for an empty account list', () => {
      expect(planAccountActions([], [])).toEqual({ toDelete: [], toPreserve: [], toReuse: [], toCreate: [] });
    });
  });

  describe('reuse — the duplicate-account fix', () => {
    it('reuses an exact name match instead of deleting + recreating it', () => {
      const { toDelete, toReuse } = planAccountActions([{ name: 'Card', type: 'credit_card' }], [base]);
      expect(toDelete).toEqual([]);
      expect(toReuse).toEqual([{ id: 'a1', name: 'Card', type: 'credit_card', refreshProvenance: true }]);
    });

    it('matches case- and whitespace-insensitively', () => {
      const { toReuse } = planAccountActions([{ name: '  card  ', type: 'credit_card' }], [base]);
      expect(toReuse).toEqual([{ id: 'a1', name: 'Card', type: 'credit_card', refreshProvenance: true }]);
    });

    it('creates fresh when no existing account matches', () => {
      const { toCreate, toReuse } = planAccountActions([{ name: 'New Card', type: 'credit_card' }], [base]);
      expect(toReuse).toEqual([]);
      expect(toCreate).toEqual([{ name: 'New Card', type: 'credit_card' }]);
      // the unclaimed existing account still gets its normal delete/preserve treatment
    });

    it('does not match across account types (a savings account named "Card" is not a credit_card match)', () => {
      const goalAccount = { ...base, type: 'savings' as const };
      const { toReuse, toCreate } = planAccountActions([{ name: 'Card', type: 'credit_card' }], [goalAccount]);
      expect(toReuse).toEqual([]);
      expect(toCreate).toEqual([{ name: 'Card', type: 'credit_card' }]);
    });

    it('reuses a FUNDED goal account by name and does not refresh its provenance', () => {
      const fundedGoal: AccountProvenanceInfo = {
        id: 'g1', name: 'Emergency fund', type: 'savings', file_import_id: 'imp1',
        transactionCount: 4, envelopeItemCount: 0, monthlyGoalCount: 0,
      };
      const { toReuse, toDelete } = planAccountActions([{ name: 'Emergency fund', type: 'savings' }], [fundedGoal]);
      expect(toDelete).toEqual([]);
      expect(toReuse).toEqual([{ id: 'g1', name: 'Emergency fund', type: 'savings', refreshProvenance: false }]);
    });

    it('reuses a manually-added account (no provenance) by name without ever touching its provenance', () => {
      const manualAccount = { ...base, file_import_id: null };
      const { toReuse } = planAccountActions([{ name: 'Card', type: 'credit_card' }], [manualAccount]);
      expect(toReuse).toEqual([{ id: 'a1', name: 'Card', type: 'credit_card', refreshProvenance: false }]);
    });

    it('a reused account never also appears in toDelete or toPreserve', () => {
      const { toReuse, toDelete, toPreserve } = planAccountActions([{ name: 'Card', type: 'credit_card' }], [base]);
      expect(toReuse).toHaveLength(1);
      expect(toDelete).toEqual([]);
      expect(toPreserve).toEqual([]);
    });

    it('four never-funded goal accounts with no name match are still correctly deleted (step (c) regression)', () => {
      const goals: AccountProvenanceInfo[] = ['Pay off credit line', 'Theme Park trip', 'Brazil trip', 'Emergency fund']
        .map((name, i) => ({ id: `g${i}`, name, type: 'savings' as const, file_import_id: 'imp1', transactionCount: 0, envelopeItemCount: 0, monthlyGoalCount: 0 }));
      const { toDelete } = planAccountActions([], goals);
      expect(toDelete).toHaveLength(4);
    });

    it('two desired accounts cannot claim the same existing account', () => {
      const { toReuse, toCreate } = planAccountActions(
        [{ name: 'Card', type: 'credit_card' }, { name: 'card', type: 'credit_card' }],
        [base]
      );
      expect(toReuse).toHaveLength(1);
      expect(toCreate).toEqual([{ name: 'card', type: 'credit_card' }]);
    });
  });
});

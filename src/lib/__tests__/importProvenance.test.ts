import { describe, it, expect } from 'vitest';
import {
  buildFileImportRow,
  resolveTransactionSource,
  needsReplaceConfirmation,
  partitionByProvenance,
  missingSeedCategories,
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

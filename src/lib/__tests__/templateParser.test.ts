import { describe, it, expect } from 'vitest';
import { isPhareTemplate, parseSection } from '../templateParser';

describe('isPhareTemplate', () => {
  const validSheets = [
    'Household', 'Monthly Income', 'Fixed Expenses',
    'Variable Expenses', 'Annual Expenses', 'Goals',
  ];

  it('accepts a workbook with all required sheets', () => {
    expect(isPhareTemplate(validSheets)).toBe(true);
  });

  it('accepts extra sheets as long as required ones are present', () => {
    expect(isPhareTemplate([...validSheets, 'Notes', 'Dashboard'])).toBe(true);
  });

  it('rejects when a required sheet is missing', () => {
    const missingGoals = validSheets.filter((s) => s !== 'Goals');
    expect(isPhareTemplate(missingGoals)).toBe(false);
  });

  it('rejects an empty workbook', () => {
    expect(isPhareTemplate([])).toBe(false);
  });

  it('is case-sensitive on sheet names', () => {
    const lowercased = validSheets.map((s) => s.toLowerCase());
    expect(isPhareTemplate(lowercased)).toBe(false);
  });
});

describe('parseSection', () => {
  // rows[labelCol] = label, rows[amountCol] = amount
  it('extracts label/amount pairs from the start row onward', () => {
    const rows = [
      ['header', null, null],      // row 0 — skipped (before startRow)
      ['Mortgage', null, 1283.97], // row 1 — label col 0, amount col 2
      ['Car loan', null, 418.94],
    ];
    const result = parseSection(rows, 0, 2, 1, []);
    expect(result).toEqual([
      { label: 'Mortgage', amount: 1283.97 },
      { label: 'Car loan', amount: 418.94 },
    ]);
  });

  it('skips rows before startRow', () => {
    const rows = [
      ['Should skip', null, 999],
      ['Should keep', null, 100],
    ];
    const result = parseSection(rows, 0, 2, 1, []);
    expect(result).toEqual([{ label: 'Should keep', amount: 100 }]);
  });

  it('skips rows whose label contains a skip word', () => {
    const rows = [
      ['Source', null, 50],   // skip word 'source'
      ['Salary', null, 3000],
    ];
    const result = parseSection(rows, 0, 2, 0, ['source']);
    expect(result).toEqual([{ label: 'Salary', amount: 3000 }]);
  });

  it('skip words are case-insensitive', () => {
    const rows = [['EXPENSE header', null, 50], ['Rent', null, 1500]];
    const result = parseSection(rows, 0, 2, 0, ['expense']);
    expect(result).toEqual([{ label: 'Rent', amount: 1500 }]);
  });

  it('skips zero amounts', () => {
    const rows = [['Empty line', null, 0], ['Real line', null, 200]];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([{ label: 'Real line', amount: 200 }]);
  });

  it('skips rows with non-numeric amounts', () => {
    const rows = [['Text amount', null, 'N/A'], ['Good', null, 99]];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([{ label: 'Good', amount: 99 }]);
  });

  it('skips rows with blank or non-string labels', () => {
    const rows = [
      [null, null, 100],
      ['', null, 200],
      [42, null, 300],
      ['Valid', null, 400],
    ];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([{ label: 'Valid', amount: 400 }]);
  });

  it('trims whitespace from labels', () => {
    const rows = [['  Spaced  ', null, 50]];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([{ label: 'Spaced', amount: 50 }]);
  });

  it('handles negative amounts (keeps them — they are non-zero)', () => {
    const rows = [['Credit', null, -50]];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([{ label: 'Credit', amount: -50 }]);
  });

  it('returns empty array when no rows qualify', () => {
    const rows = [['Header', null, null]];
    const result = parseSection(rows, 0, 2, 0, []);
    expect(result).toEqual([]);
  });
});
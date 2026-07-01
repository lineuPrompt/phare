import { describe, it, expect } from 'vitest';
import { isPhareTemplate, parseSection, detectIncomeSheetVersion } from '../templateParser';

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

// ---------------------------------------------------------------------------
// detectIncomeSheetVersion
// ---------------------------------------------------------------------------
// The version is determined ONCE from header rows 0–4 only.
// Data rows (index >= 5) NEVER influence the result.
//
// v2 signal: a cell in col 2 of rows 0–4 that is exactly "Frequency" or
//            "Fréquence" (case-insensitive, trimmed).
// v1:        everything else — no v2 signal found in the header area.
//
// This replaces the old per-row heuristic (detectFrequency(row[2])) which
// could silently misparse a v1 template if any data cell in col 2 happened
// to contain a frequency-like word such as "Monthly".
// ---------------------------------------------------------------------------

describe('detectIncomeSheetVersion', () => {
  // Helper: build a row array where rows 0–4 are header area, rows 5+ are data.
  function makeRows(
    headerCol2Values: (string | null)[],
    dataRows: unknown[][] = [],
  ): unknown[][] {
    // Pad to 5 header rows
    const headers: unknown[][] = Array.from({ length: 5 }, (_, i) => [
      null,
      null,
      headerCol2Values[i] ?? null,
    ]);
    return [...headers, ...dataRows];
  }

  it('returns v1 when no header row has a frequency column label', () => {
    const rows = makeRows([null, null, null, null, 'Monthly Amount']);
    expect(detectIncomeSheetVersion(rows)).toBe('v1');
  });

  it('returns v2 when a header row has "Frequency" in col 2 (exact, English)', () => {
    const rows = makeRows([null, null, null, null, 'Frequency']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });

  it('returns v2 when a header row has "Fréquence" in col 2 (French accented)', () => {
    const rows = makeRows([null, null, null, null, 'Fréquence']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });

  it('returns v2 when a header row has "frequence" in col 2 (French unaccented)', () => {
    const rows = makeRows([null, null, null, null, 'frequence']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });

  it('is case-insensitive — "FREQUENCY" and "frequency" both trigger v2', () => {
    expect(detectIncomeSheetVersion(makeRows([null, null, null, null, 'FREQUENCY']))).toBe('v2');
    expect(detectIncomeSheetVersion(makeRows([null, null, null, null, 'frequency']))).toBe('v2');
  });

  it('ignores leading/trailing whitespace in header cells', () => {
    const rows = makeRows([null, null, null, null, '  Frequency  ']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });

  it('returns v1 when "Monthly Amount" is in col 2 of a header row (not the v2 signal)', () => {
    const rows = makeRows([null, null, null, null, 'Monthly Amount']);
    expect(detectIncomeSheetVersion(rows)).toBe('v1');
  });

  it('returns v1 when rows array is empty', () => {
    expect(detectIncomeSheetVersion([])).toBe('v1');
  });

  it('returns v1 when all header rows have null col 2', () => {
    const rows = makeRows([null, null, null, null, null]);
    expect(detectIncomeSheetVersion(rows)).toBe('v1');
  });

  it('detects v2 signal in any of the first 5 header rows (not just row 4)', () => {
    // Signal in row 0
    expect(detectIncomeSheetVersion(makeRows(['Frequency', null, null, null, null]))).toBe('v2');
    // Signal in row 2
    expect(detectIncomeSheetVersion(makeRows([null, null, 'Frequency', null, null]))).toBe('v2');
  });

  // --- Regression test ---
  // The old per-row heuristic called detectFrequency(row[2]) on EVERY row including
  // data rows starting at index 5.  If a v1 data row had the word "Monthly" in col 2,
  // the heuristic would silently switch to v2 mode for that row and read col 1 as the
  // paycheque amount — picking up the WRONG column, producing silent wrong income.
  //
  // The fix: version is detected from header rows 0–4 only.  A data row with "Monthly"
  // in col 2 cannot trigger v2 mode.  It is simply not a number, so in v1 mode the row
  // is skipped — transparent missing data, not a silent wrong value.

  it('REGRESSION — v1 template: "Monthly" in a DATA row col 2 does NOT trigger v2 detection', () => {
    // col 1 of these data rows has a number (e.g. an accidental amount in the wrong column)
    // that the old per-row heuristic would have read as the v2 paycheque amount.
    const dataRows: unknown[][] = [
      ['Salary', 2397.85, 'Monthly'],       // "Monthly" in data col 2
      ['Part-time work', 800, 'Monthly'],   // ditto
    ];
    const rows = makeRows(
      [null, null, null, null, 'Monthly Amount'], // v1 header — col 2 says "Monthly Amount"
      dataRows,
    );
    // Version must be v1 — data content must never influence version detection.
    expect(detectIncomeSheetVersion(rows)).toBe('v1');
    // Consequence: in v1 mode parseIncome reads col 2 as the monthly dollar amount.
    // col 2 here is the string "Monthly", which is not a number → the row is skipped.
    // The old code would have read col 1 (2397.85) as a monthly-frequency paycheque
    // and produced $2,397.85/month instead of $0 — a silent undercount of income.
  });

  it('REGRESSION — "Frequency" appearing ONLY in a data row (>= index 5) does NOT trigger v2', () => {
    // This verifies the old heuristic bug: if a data row contained the word "Frequency"
    // in col 2, the old code would fire detectFrequency("Frequency") → null (not a match),
    // so this specific word didn't trigger the old bug.  But "Monthly" / "Weekly" etc. did.
    // This test documents that we only trust the header area.
    const dataRows: unknown[][] = [
      ['Frequency', 1000, 'Weekly'],  // col 0 happens to say "Frequency" — doesn't matter
    ];
    const rows = makeRows([null, null, null, null, 'Monthly Amount'], dataRows);
    expect(detectIncomeSheetVersion(rows)).toBe('v1');
  });

  it('v2 template with "Frequency" header and data rows is detected as v2', () => {
    const dataRows: unknown[][] = [
      ['Salary', 2397.85, 'bi-weekly'],
      ['Partner salary', 1500, 'monthly'],
    ];
    const rows = makeRows([null, null, null, null, 'Frequency'], dataRows);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });
});

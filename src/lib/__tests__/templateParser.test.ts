import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  isPhareTemplate,
  parseSection,
  detectIncomeSheetVersion,
  parseFrequencyCell,
  parseTemplate,
} from '../templateParser';

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

  // This is the specific case that caused the production bug:
  // the shipped template uses the BILINGUAL combined header "Frequency / Fréquence",
  // not just the bare word "Frequency".  The old === check missed it → v1 was returned
  // → col 2 frequency strings were read as dollar amounts → all rows skipped → $0 income.
  it('BUG REGRESSION — bilingual "Frequency / Fréquence" header is detected as v2', () => {
    const rows = makeRows([null, null, null, null, 'Frequency / Fréquence']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });

  it('bilingual header is case-insensitive', () => {
    const rows = makeRows([null, null, null, null, 'FREQUENCY / FRÉQUENCE']);
    expect(detectIncomeSheetVersion(rows)).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// parseFrequencyCell
// ---------------------------------------------------------------------------
// The shipped v2 template uses hyphenated strings: "bi-weekly", "semi-monthly".
// The parser must also accept space variants ("bi weekly", "semi monthly") and
// French equivalents.
// ---------------------------------------------------------------------------

describe('parseFrequencyCell', () => {
  // ── English canonical (as shipped in template) ──
  it('accepts "weekly"', () => expect(parseFrequencyCell('weekly')).toBe('weekly'));
  it('accepts "bi-weekly" (hyphenated, as shipped)', () => expect(parseFrequencyCell('bi-weekly')).toBe('biweekly'));
  it('accepts "bi weekly" (space variant)', () => expect(parseFrequencyCell('bi weekly')).toBe('biweekly'));
  it('accepts "biweekly" (no separator)', () => expect(parseFrequencyCell('biweekly')).toBe('biweekly'));
  it('accepts "semi-monthly" (hyphenated, as shipped)', () => expect(parseFrequencyCell('semi-monthly')).toBe('semimonthly'));
  it('accepts "semi monthly" (space variant)', () => expect(parseFrequencyCell('semi monthly')).toBe('semimonthly'));
  it('accepts "semimonthly" (no separator)', () => expect(parseFrequencyCell('semimonthly')).toBe('semimonthly'));
  it('accepts "monthly"', () => expect(parseFrequencyCell('monthly')).toBe('monthly'));

  // ── French equivalents ──
  it('accepts "hebdomadaire"', () => expect(parseFrequencyCell('hebdomadaire')).toBe('weekly'));
  it('accepts "bi-hebdomadaire"', () => expect(parseFrequencyCell('bi-hebdomadaire')).toBe('biweekly'));
  it('accepts "toutes les 2 semaines"', () => expect(parseFrequencyCell('toutes les 2 semaines')).toBe('biweekly'));
  it('accepts "deux fois par mois"', () => expect(parseFrequencyCell('deux fois par mois')).toBe('semimonthly'));
  it('accepts "semi-mensuel"', () => expect(parseFrequencyCell('semi-mensuel')).toBe('semimonthly'));
  it('accepts "mensuel"', () => expect(parseFrequencyCell('mensuel')).toBe('monthly'));
  it('accepts "mensuelle"', () => expect(parseFrequencyCell('mensuelle')).toBe('monthly'));

  // ── Case/whitespace tolerance ──
  it('is case-insensitive', () => expect(parseFrequencyCell('Bi-Weekly')).toBe('biweekly'));
  it('trims whitespace', () => expect(parseFrequencyCell('  monthly  ')).toBe('monthly'));

  // ── Rejects invalid strings ──
  it('returns null for unrecognised strings', () => expect(parseFrequencyCell('fortnightly')).toBeNull());
  it('returns null for non-string values', () => expect(parseFrequencyCell(42)).toBeNull());
  it('returns null for null', () => expect(parseFrequencyCell(null)).toBeNull());
});

// ---------------------------------------------------------------------------
// parseTemplate — end-to-end v2 income parsing
// ---------------------------------------------------------------------------
// Build a minimal XLSX buffer that mimics the actual v2 template layout and
// verify parseTemplate produces the correct income total.
// ---------------------------------------------------------------------------

function buildMinimalWorkbook(incomeRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();

  const addSheet = (name: string, data: unknown[][] = []) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data as XLSX.CellObject[][], {cellDates: false}), name);
  };

  addSheet('Household');
  addSheet('Monthly Income', incomeRows);
  // Fixed Expenses: parseSection(rows, 0, 2, startRow=2, skipWords)
  addSheet('Fixed Expenses', [[], [], ['Rent', null, 1200]]);
  // Variable Expenses: parseSection(rows, 0, 1, startRow=3, skipWords)
  addSheet('Variable Expenses', [[], [], [], ['Groceries', 800]]);
  // Annual Expenses: startRow=5, label=col0, annual=col1, dueMonth=col3
  addSheet('Annual Expenses', [[], [], [], [], [], ['Car Insurance', 1200, null, 'March']]);
  addSheet('Goals');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('parseTemplate — v2 income parsing (end-to-end)', () => {
  // The actual v2 template layout:
  //   Rows 0–3: other header content
  //   Row 4:    [null, null, "Frequency / Fréquence"]  ← bilingual combined header
  //   Row 5+:   data rows [label, paychequeAmount, frequencyString]
  function makeV2IncomeRows(dataRows: unknown[][]): unknown[][] {
    return [
      [null, null, null],           // row 0
      [null, null, null],           // row 1
      [null, null, null],           // row 2
      [null, null, null],           // row 3
      [null, null, 'Frequency / Fréquence'], // row 4 — bilingual header (the production case)
      ...dataRows,                   // rows 5+
    ];
  }

  it('BUG REGRESSION — bilingual header + bi-weekly/monthly rows produce correct income total', () => {
    // Salary: $2,397.85 bi-weekly → 2397.85 × 26 / 12 = $5,195.34/month
    // Partner: $1,500 monthly → $1,500/month
    // Total: $6,695.34/month
    const incomeRows = makeV2IncomeRows([
      ['Salary', 2397.85, 'bi-weekly'],
      ['Partner salary', 1500, 'monthly'],
    ]);
    const buf = buildMinimalWorkbook(incomeRows);
    const result = parseTemplate(buf);

    expect(result.isTemplate).toBe(true);
    expect(result.incomeLayout).toBe('v2');
    expect(result.income.lines).toHaveLength(2);
    expect(result.income.total).toBe(Math.round((2397.85 * 26 / 12 + 1500) * 100) / 100);
    expect(result.incomeSkippedRows).toBe(0);
  });

  it('v2 template with all four frequency strings parses correctly', () => {
    const incomeRows = makeV2IncomeRows([
      ['Weekly pay',     1000, 'weekly'],        // 1000 × 52/12 = 4333.33
      ['Bi-weekly pay',  2000, 'bi-weekly'],     // 2000 × 26/12 = 4333.33
      ['Semi-monthly pay', 2000, 'semi-monthly'],// 2000 × 2     = 4000
      ['Monthly pay',    5000, 'monthly'],       // 5000
    ]);
    const buf = buildMinimalWorkbook(incomeRows);
    const result = parseTemplate(buf);

    expect(result.incomeLayout).toBe('v2');
    expect(result.income.lines).toHaveLength(4);
    expect(result.incomeSkippedRows).toBe(0);
    // All four rows contributed to total
    expect(result.income.total).toBeGreaterThan(0);
  });

  it('v2 rows with an unrecognised frequency string are counted as skipped, not silently dropped', () => {
    const incomeRows = makeV2IncomeRows([
      ['Salary', 3000, 'bi-weekly'],       // valid → contributes
      ['Bonus', 500, 'fortnightly'],        // invalid → skipped, counted
      ['Rental', 800, 'monthly'],           // valid → contributes
    ]);
    const buf = buildMinimalWorkbook(incomeRows);
    const result = parseTemplate(buf);

    expect(result.incomeLayout).toBe('v2');
    expect(result.income.lines).toHaveLength(2);  // 2 valid rows
    expect(result.incomeSkippedRows).toBe(1);      // 1 row with bad frequency
    expect(result.income.total).toBeGreaterThan(0); // did NOT silently collapse to $0
  });

  it('v2 with ALL invalid frequency strings: incomeSkippedRows equals row count, income is $0', () => {
    const incomeRows = makeV2IncomeRows([
      ['Salary', 3000, 'fortnightly'],
      ['Bonus',  500,  'quaterly'],
    ]);
    const buf = buildMinimalWorkbook(incomeRows);
    const result = parseTemplate(buf);

    expect(result.income.total).toBe(0);
    expect(result.incomeSkippedRows).toBe(2);  // caller can surface this — not a silent $0
  });

  it('v1 template (no frequency header): parses col 2 as monthly amount; incomeSkippedRows is 0', () => {
    const incomeRows: unknown[][] = [
      [null, null, null],
      [null, null, null],
      [null, null, null],
      [null, null, null],
      [null, null, 'Monthly Amount'],  // v1 header
      ['Salary', null, 4800],
      ['Rental', null, 1200],
    ];
    const buf = buildMinimalWorkbook(incomeRows);
    const result = parseTemplate(buf);

    expect(result.incomeLayout).toBe('v1');
    expect(result.income.total).toBe(6000);
    expect(result.incomeSkippedRows).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  isPhareTemplate,
  parseSection,
  parseFrequencyCell,
  parseExpenseFrequencyCell,
  isValidV3Template,
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
// parseFrequencyCell
// ---------------------------------------------------------------------------
// The shipped v3 template uses hyphenated strings: "bi-weekly", "semi-monthly".
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

describe('parseExpenseFrequencyCell', () => {
  it('treats a blank cell as monthly (unlike income, which requires an explicit value)', () => {
    expect(parseExpenseFrequencyCell(null)).toBe('monthly');
    expect(parseExpenseFrequencyCell(undefined)).toBe('monthly');
    expect(parseExpenseFrequencyCell('')).toBe('monthly');
    expect(parseExpenseFrequencyCell('   ')).toBe('monthly');
  });

  it('accepts the same frequency strings as income', () => {
    expect(parseExpenseFrequencyCell('bi-weekly')).toBe('biweekly');
    expect(parseExpenseFrequencyCell('semi-monthly')).toBe('semimonthly');
    expect(parseExpenseFrequencyCell('weekly')).toBe('weekly');
    expect(parseExpenseFrequencyCell('monthly')).toBe('monthly');
  });

  it('rejects an unrecognised, non-blank string (does not guess)', () => {
    expect(parseExpenseFrequencyCell('fortnightly')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shared fixture builders — always v3-shaped (Frequency column on both
// sheets) unless a test deliberately omits one to exercise refusal.
// ---------------------------------------------------------------------------

// Income: rows 0–3 header content, row 4 the bilingual column-label row
// (the production case — the shipped template's real header), row 5+ data.
function makeV3IncomeRows(dataRows: unknown[][]): unknown[][] {
  return [
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    ['Source', 'Amount per paycheque / Montant par paie', 'Frequency / Fréquence', 'Member / Membre'],
    ...dataRows,
  ];
}

// Fixed Expenses: rows 0–1 header content, row 2 the column-label row, row 3+ data.
function makeV3FixedExpenseRows(dataRows: unknown[][]): unknown[][] {
  return [
    ['FIXED MONTHLY EXPENSES / DÉPENSES FIXES MENSUELLES'],
    [null],
    ['Expense / Dépense', 'Category / Catégorie', 'Amount per payment / Montant par paiement', 'Frequency / Fréquence', 'Account / Compte', 'Notes'],
    ...dataRows,
  ];
}

function buildWorkbook(incomeRows: unknown[][], fixedExpenseRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, data: unknown[][] = []) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data as XLSX.CellObject[][], { cellDates: false }), name);
  };

  addSheet('Household');
  addSheet('Monthly Income', incomeRows);
  addSheet('Fixed Expenses', fixedExpenseRows);
  // Variable Expenses: parseSection(rows, 0, 1, startRow=3, skipWords)
  addSheet('Variable Expenses', [[], [], [], ['Groceries', 800]]);
  // Annual Expenses: startRow=5, label=col0, annual=col1, dueMonth=col3
  addSheet('Annual Expenses', [[], [], [], [], [], ['Car Insurance', 1200, null, 'March']]);
  addSheet('Goals');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

const DEFAULT_INCOME_ROWS = makeV3IncomeRows([]);
const DEFAULT_EXPENSE_ROWS = makeV3FixedExpenseRows([]);

// ---------------------------------------------------------------------------
// isValidV3Template — exact-match-or-refuse contract
// ---------------------------------------------------------------------------

describe('isValidV3Template', () => {
  it('accepts a workbook with the Frequency column present on both sheets', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(true);
  });

  it('rejects when the required sheets are missing entirely', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['unrelated']]), 'Sheet1');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(false);
  });

  it('rejects a v2-shaped file: right sheets, but Fixed Expenses has no Frequency column', () => {
    // The pre-v3 Fixed Expenses layout: Expense / Category / Amount / Account / Notes — no Frequency.
    const v2ExpenseRows = [
      ['FIXED MONTHLY EXPENSES'],
      [null],
      ['Expense / Dépense', 'Category / Catégorie', 'Amount / Montant', 'Account / Compte', 'Notes'],
      ['Mortgage', 'Housing', 1500, 'Chequing', null],
    ];
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, v2ExpenseRows);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(false);
  });

  it('rejects when Monthly Income has no Frequency column (pre-v2 layout)', () => {
    const v1IncomeRows = [
      [null, null, null], [null, null, null], [null, null, null], [null, null, null],
      [null, null, 'Monthly Amount'],
      ['Salary', null, 4800],
    ];
    const buf = buildWorkbook(v1IncomeRows, DEFAULT_EXPENSE_ROWS);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(false);
  });

  it('is case-insensitive and matches the bilingual combined header', () => {
    const rows = makeV3FixedExpenseRows([]);
    rows[2] = ['Expense', 'Category', 'Amount', 'FREQUENCY / FRÉQUENCE', 'Account', 'Notes'];
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, rows);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(true);
  });

  it('does not trust a data row outside the header window — only the header area counts', () => {
    const rows = [
      ['Expense / Dépense', 'Category / Catégorie', 'Amount / Montant', 'Account / Compte', 'Notes'], // header, row 0 — no Frequency
      [null, null, null, null, null], // row 1
      [null, null, null, null, null], // row 2
      ['Mortgage', 'Housing', 1500, 'Frequency', 'Chequing'], // row 3 — a data row, out of header window
    ];
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, rows);
    const workbook = XLSX.read(buf, { type: 'buffer' });
    expect(isValidV3Template(workbook)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseTemplate — refuses, never partially parses, a non-v3 file
// ---------------------------------------------------------------------------

describe('parseTemplate — refusal contract', () => {
  it('a workbook missing the required sheets: isTemplate false, isValidV3 false, nothing parsed', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['unrelated']]), 'Sheet1');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
    const result = parseTemplate(buf);
    expect(result.isTemplate).toBe(false);
    expect(result.isValidV3).toBe(false);
    expect(result.income.lines).toEqual([]);
  });

  it("a v2-shaped file (no expense Frequency column) is refused — not parsed as monthly", () => {
    const v2ExpenseRows = [
      ['FIXED MONTHLY EXPENSES'],
      [null],
      ['Expense / Dépense', 'Category / Catégorie', 'Amount / Montant', 'Account / Compte', 'Notes'],
      ['Mortgage', 'Housing', 1500, 'Chequing', null], // would silently become $1,500/mo under the old legacy path
    ];
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, v2ExpenseRows);
    const result = parseTemplate(buf);

    // Right sheets exist, so isTemplate is true, but the outdated column
    // layout must refuse — never parse Mortgage as a $1,500/month line.
    expect(result.isTemplate).toBe(true);
    expect(result.isValidV3).toBe(false);
    expect(result.fixedExpenses.lines).toEqual([]);
    expect(result.fixedExpenses.total).toBe(0);
  });

  it('a fully valid v3 file parses normally', () => {
    const incomeRows = makeV3IncomeRows([
      ['Salary / Salaire', 2397.85, 'bi-weekly', 'Lineu'],
    ]);
    const expenseRows = makeV3FixedExpenseRows([
      ['Mortgage / Hypothèque', 'Housing', 1500, 'bi-weekly', 'Chequing', null],
    ]);
    const buf = buildWorkbook(incomeRows, expenseRows);
    const result = parseTemplate(buf);

    expect(result.isTemplate).toBe(true);
    expect(result.isValidV3).toBe(true);
    expect(result.income.lines).toEqual([
      { label: 'Salary / Salaire', amount: 5195.34, rawAmount: 2397.85, frequency: 'biweekly', member: 'Lineu' },
    ]);
    expect(result.fixedExpenses.lines).toEqual([
      { label: 'Mortgage / Hypothèque', amount: 3250, rawAmount: 1500, frequency: 'biweekly' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseTemplate — income parsing (end-to-end)
// ---------------------------------------------------------------------------

describe('parseTemplate — income parsing (end-to-end)', () => {
  it('BUG REGRESSION — bilingual header + bi-weekly/monthly rows produce correct income total', () => {
    // Salary: $2,397.85 bi-weekly → 2397.85 × 26 / 12 = $5,195.34/month
    // Partner: $1,500 monthly → $1,500/month
    // Total: $6,695.34/month
    const incomeRows = makeV3IncomeRows([
      ['Salary', 2397.85, 'bi-weekly'],
      ['Partner salary', 1500, 'monthly'],
    ]);
    const buf = buildWorkbook(incomeRows, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    expect(result.isTemplate).toBe(true);
    expect(result.isValidV3).toBe(true);
    expect(result.income.lines).toHaveLength(2);
    expect(result.income.total).toBe(Math.round((2397.85 * 26 / 12 + 1500) * 100) / 100);
    expect(result.incomeSkippedRows).toBe(0);
  });

  it('all four frequency strings parse correctly', () => {
    const incomeRows = makeV3IncomeRows([
      ['Weekly pay',     1000, 'weekly'],        // 1000 × 52/12 = 4333.33
      ['Bi-weekly pay',  2000, 'bi-weekly'],     // 2000 × 26/12 = 4333.33
      ['Semi-monthly pay', 2000, 'semi-monthly'],// 2000 × 2     = 4000
      ['Monthly pay',    5000, 'monthly'],       // 5000
    ]);
    const buf = buildWorkbook(incomeRows, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    expect(result.income.lines).toHaveLength(4);
    expect(result.incomeSkippedRows).toBe(0);
    expect(result.income.total).toBeGreaterThan(0);
  });

  it('rows with an unrecognised frequency string are counted as skipped, not silently dropped', () => {
    const incomeRows = makeV3IncomeRows([
      ['Salary', 3000, 'bi-weekly'],       // valid → contributes
      ['Bonus', 500, 'fortnightly'],        // invalid → skipped, counted
      ['Rental', 800, 'monthly'],           // valid → contributes
    ]);
    const buf = buildWorkbook(incomeRows, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    expect(result.income.lines).toHaveLength(2);  // 2 valid rows
    expect(result.incomeSkippedRows).toBe(1);      // 1 row with bad frequency
    expect(result.income.total).toBeGreaterThan(0); // did NOT silently collapse to $0
  });

  it('with ALL invalid frequency strings: incomeSkippedRows equals row count, income is $0', () => {
    const incomeRows = makeV3IncomeRows([
      ['Salary', 3000, 'fortnightly'],
      ['Bonus',  500,  'quaterly'],
    ]);
    const buf = buildWorkbook(incomeRows, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    expect(result.income.total).toBe(0);
    expect(result.incomeSkippedRows).toBe(2);  // caller can surface this — not a silent $0
  });

  // Regression fixture from the Build 3 Phase A/B onboarding-import bug:
  // the shipped template's real Monthly Income sheet has FOUR income rows
  // (two salary rows for the same person on different pay schedules, plus
  // two monthly child-benefit rows) and a "Member / Membre" column (col 3)
  // that must be captured, not dropped.
  it('BUILD 3 — four-row shipped-template fixture: member captured, snapshot income is exactly $11,155.03 on two consecutive parses', () => {
    const incomeRows = makeV3IncomeRows([
      ['Salary / Salaire', 2397.85, 'bi-weekly', 'Lineu', 'One paycheque; paid every 2 weeks (26/yr)'],
      ['Salary / Salaire', 2787.97, 'semi-monthly', 'Julia', 'One paycheque; paid 15th & 30th (24/yr)'],
      ['Child benefit / Quebec', 203.50, 'monthly', null, 'CCB'],
      ['Child benefit / Federal', 180.25, 'monthly', null, 'CCB'],
    ]);
    const buf = buildWorkbook(incomeRows, DEFAULT_EXPENSE_ROWS);

    // Parsing is pure and deterministic — "two consecutive imports of the
    // same file" must produce the identical snapshot both times.
    const first = parseTemplate(buf);
    const second = parseTemplate(buf);

    for (const result of [first, second]) {
      expect(result.income.lines).toHaveLength(4);
      expect(result.incomeSkippedRows).toBe(0);
      expect(result.income.total).toBe(11155.03);
      expect(result.summary.monthlyIncome).toBe(11155.03);
    }

    expect(first.income.lines[0]).toEqual({
      label: 'Salary / Salaire', amount: 5195.34, rawAmount: 2397.85, frequency: 'biweekly', member: 'Lineu',
    });
    expect(first.income.lines[1]).toEqual({
      label: 'Salary / Salaire', amount: 5575.94, rawAmount: 2787.97, frequency: 'semimonthly', member: 'Julia',
    });
    // Child-benefit rows have no Member cell — member is correctly absent, not fabricated.
    expect(first.income.lines[2].member).toBeUndefined();
    expect(first.income.lines[3].member).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseTemplate — fixed-expense frequency parsing (end-to-end)
// Phase D: the income-frequency bug's expense-side twin. A bi-weekly
// mortgage payment of $1,500 must convert to $3,250/month
// (1500 × 26 / 12 = 3250), not collapse to $1,500/month.
// ---------------------------------------------------------------------------

describe('parseTemplate — fixed-expense parsing (end-to-end)', () => {
  it('a bi-weekly $1,500 payment converts to $3,250/month, not $1,500/month', () => {
    const fixedRows = makeV3FixedExpenseRows([
      ['Mortgage / Hypothèque', 'Housing', 1500, 'bi-weekly', 'Chequing', null],
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, fixedRows);
    const result = parseTemplate(buf);

    expect(result.fixedExpenses.lines).toEqual([
      { label: 'Mortgage / Hypothèque', amount: 3250, rawAmount: 1500, frequency: 'biweekly' },
    ]);
    expect(result.fixedExpenses.total).toBe(3250);
  });

  it('a blank frequency cell defaults to monthly', () => {
    const fixedRows = makeV3FixedExpenseRows([
      ['Internet', 'Utilities & Subscriptions', 80, null, 'Chequing', null],
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, fixedRows);
    const result = parseTemplate(buf);

    expect(result.fixedExpenses.lines).toEqual([
      { label: 'Internet', amount: 80, rawAmount: 80, frequency: 'monthly' },
    ]);
    expect(result.fixedExpenseSkippedRows).toBe(0);
  });

  it('an unrecognised, non-blank frequency string is skipped and counted, not silently dropped or guessed', () => {
    const fixedRows = makeV3FixedExpenseRows([
      ['Mortgage', 'Housing', 1500, 'bi-weekly', 'Chequing', null],   // valid → contributes
      ['Gym', 'Health & Personal', 40, 'fortnightly', 'Chequing', null], // invalid → skipped, counted
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, fixedRows);
    const result = parseTemplate(buf);

    expect(result.fixedExpenses.lines).toHaveLength(1);
    expect(result.fixedExpenseSkippedRows).toBe(1);
  });

  // The founder's fixture: three bi-weekly fixed expenses (mortgage + two car
  // payments) that were previously collapsing to their per-payment amount
  // once a month, understating fixed expenses by thousands per month.
  it("FOUNDER'S FIXTURE — three bi-weekly lines convert correctly; total monthly fixed expenses is exact", () => {
    const fixedRows = makeV3FixedExpenseRows([
      ['Mortgage / Hypothèque', 'Housing', 1500, 'bi-weekly', 'Chequing', null],       // 1500 × 26/12 = 3250
      ['Car payment 1 / Paiement auto 1', 'Transportation', 350, 'bi-weekly', 'Chequing', null], // 350 × 26/12 = 758.33
      ['Car payment 2 / Paiement auto 2', 'Transportation', 275, 'bi-weekly', 'Chequing', null], // 275 × 26/12 = 595.83
      ['Home insurance / Assurance maison', 'Housing', 120, null, 'Chequing', null],   // blank → monthly, 120
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, fixedRows);
    const result = parseTemplate(buf);

    expect(result.fixedExpenseSkippedRows).toBe(0);
    expect(result.fixedExpenses.lines).toHaveLength(4);

    const mortgage = result.fixedExpenses.lines.find((l) => l.label.startsWith('Mortgage'))!;
    const car1 = result.fixedExpenses.lines.find((l) => l.label.includes('auto 1'))!;
    const car2 = result.fixedExpenses.lines.find((l) => l.label.includes('auto 2'))!;
    expect(mortgage.amount).toBe(3250);
    expect(car1.amount).toBe(758.33);
    expect(car2.amount).toBe(595.83);

    // 3250 + 758.33 + 595.83 + 120 = 4724.16
    expect(result.fixedExpenses.total).toBe(4724.16);
  });
});

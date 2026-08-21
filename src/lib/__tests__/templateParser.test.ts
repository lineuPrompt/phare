import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { MAX_HOUSEHOLD_KEYS } from '../promptInputLimits';
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

// Household: row 0 the sheet title, row 1 blank, row 2 the column-label row,
// row 3+ data — the shipped sheet's real shape (public/phare_template.xlsx).
// col 0 = field label, col 1 = the household's answer, col 2 = example,
// col 3 = notes; only cols 0 and 1 are read.
//
// This sheet used to be built as `addSheet('Household')` — completely empty.
// Every parseTemplate assertion in this file therefore ran against
// household === {}, so the two defects living in that loop (the header row
// read as data, and duplicate labels overwriting each other silently) were
// both invisible to a fully green suite.
function makeHouseholdRows(dataRows: unknown[][]): unknown[][] {
  return [
    ['PHARE — Household Information / Information du ménage', null, null, null],
    [null, null, null, null],
    ['Field / Champ', 'Your answer / Votre réponse', 'Example / Exemple', 'Notes'],
    ...dataRows,
  ];
}

// A household as it actually arrives from a real upload: column B filled in,
// including the blank spacer row the shipped sheet carries at index 11.
const FILLED_HOUSEHOLD_ROWS = makeHouseholdRows([
  ['Household name / Nom du ménage', 'Tremblay', 'Smith', null],
  ['Province', 'Quebec', 'Quebec', 'Important for tax context'],
  ["Number of adults / Nombre d'adultes", '2', '2', null],
  ['Member 1 name / Nom membre 1', 'Jane', 'Jane', null],
  ['Member 2 name (optional) / Nom membre 2 (facultatif)', 'John', 'John', null],
  [null, null, null, null],
  ['Credit line balance / Solde marge de crédit', 5000, 5000, null],
  ["Employer province — Member 1 / Province de l'employeur — Membre 1", 'Ontario', 'Quebec', 'tax gap'],
  ["Employer province — Member 2 / Province de l'employeur — Membre 2", 'Quebec', 'Ontario', null],
]);

// Fixed Expenses: rows 0–1 header content, row 2 the column-label row, row 3+ data.
function makeV3FixedExpenseRows(dataRows: unknown[][]): unknown[][] {
  return [
    ['FIXED MONTHLY EXPENSES / DÉPENSES FIXES MENSUELLES'],
    [null],
    ['Expense / Dépense', 'Category / Catégorie', 'Amount per payment / Montant par paiement', 'Frequency / Fréquence', 'Account / Compte', 'Notes'],
    ...dataRows,
  ];
}

function buildWorkbook(
  incomeRows: unknown[][],
  fixedExpenseRows: unknown[][],
  goalRows: unknown[][] = [],
  householdRows: unknown[][] = FILLED_HOUSEHOLD_ROWS,
): Buffer {
  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, data: unknown[][] = []) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data as XLSX.CellObject[][], { cellDates: false }), name);
  };

  addSheet('Household', householdRows);
  addSheet('Monthly Income', incomeRows);
  addSheet('Fixed Expenses', fixedExpenseRows);
  // Variable Expenses: parseSection(rows, 0, 1, startRow=3, skipWords)
  addSheet('Variable Expenses', [[], [], [], ['Groceries', 800]]);
  // Annual Expenses: startRow=5, label=col0, annual=col1, dueMonth=col3
  addSheet('Annual Expenses', [[], [], [], [], [], ['Car Insurance', 1200, null, 'March']]);
  // Goals: header rows 0-1, data from row index 2 (name col0, target col1, date col2, saved col3)
  addSheet('Goals', [
    ['GOALS / OBJECTIFS'],
    ['Goal / Objectif', 'Target amount / Montant cible', 'Target date / Date cible', 'Saved so far / Épargné'],
    ...goalRows,
  ]);

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
// parseTemplate — Household sheet
//
// This block exists because the Household fixture used to be an empty sheet,
// so every assertion elsewhere in this file ran against household === {} and
// the whole loop was untested. Two defects lived there undetected:
//   1. the sheet's header row was read as a data pair, putting
//      {"Field / Champ": "Your answer / Votre réponse"} into every prompt;
//   2. two rows sharing a label collapsed to one key, silently discarding
//      the earlier answer (both "Employer province" rows did exactly this).
// ---------------------------------------------------------------------------

describe('parseTemplate — Household sheet', () => {
  it('does NOT read the column-label header row as data', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    // The header pair specifically — this is the exact junk that shipped.
    expect(result.household).not.toHaveProperty('Field / Champ');
    expect(Object.values(result.household)).not.toContain('Your answer / Votre réponse');
    // And nothing from the two rows above it (title row, blank row) either.
    expect(Object.keys(result.household)).not.toContain(
      'PHARE — Household Information / Information du ménage',
    );
    // Real answers below the header are still read.
    expect(result.household['Household name / Nom du ménage']).toBe('Tremblay');
  });

  it('keeps both Employer province rows as distinct keys with their own answers', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS);
    const result = parseTemplate(buf);

    expect(result.household["Employer province — Member 1 / Province de l'employeur — Membre 1"]).toBe('Ontario');
    expect(result.household["Employer province — Member 2 / Province de l'employeur — Membre 2"]).toBe('Quebec');
    expect(result.householdDuplicateKeys).toBe(0);
  });

  it('counts a duplicate label instead of merging it away silently', () => {
    const rows = makeHouseholdRows([
      ['Province', 'Quebec', null, null],
      ["Employer province / Province de l'employeur", 'Ontario', null, null],
      ["Employer province / Province de l'employeur", 'Quebec', null, null], // the shipped defect
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [], rows);
    const result = parseTemplate(buf);

    // The collapse itself is unavoidable — one Record key, two rows. What
    // must never happen again is it going UNREPORTED.
    expect(result.householdDuplicateKeys).toBe(1);
    expect(Object.keys(result.household)).toHaveLength(2);
    // Documented resolution: the later row wins.
    expect(result.household["Employer province / Province de l'employeur"]).toBe('Quebec');
  });

  it('counts each duplicate separately when a label repeats more than twice', () => {
    const rows = makeHouseholdRows([
      ['Province', 'Quebec', null, null],
      ['Province', 'Ontario', null, null],
      ['Province', 'Alberta', null, null],
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [], rows);
    const result = parseTemplate(buf);

    expect(result.householdDuplicateKeys).toBe(2);
    expect(result.household).toEqual({ Province: 'Alberta' });
  });

  it('skips a non-string, non-number answer cell rather than coercing it', () => {
    const rows = makeHouseholdRows([
      ['Number of adults / Nombre d\'adultes', 2, null, null],       // number: kept, stringified
      ['Household name / Nom du ménage', 'Tremblay', null, null],    // string: kept
      ['Has a TFSA?', true, null, null],                             // boolean: skipped, not "true"
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [], rows);
    const result = parseTemplate(buf);

    expect(result.household).toEqual({
      "Number of adults / Nombre d'adultes": '2',
      'Household name / Nom du ménage': 'Tremblay',
    });
    // The specific coercion that would otherwise reach the prompt.
    expect(Object.values(result.household)).not.toContain('true');
    expect(result.householdDuplicateKeys).toBe(0);
  });

  it('PINS KNOWN GAP — a date answer reaches the prompt as an Excel serial number', () => {
    // Not a regression and not something this change introduced: sheetRows()
    // reads with cellDates unset, so Excel hands back the underlying serial
    // and the cell is genuinely a number by the time the guard sees it. The
    // string|number guard therefore admits it, exactly as the old `val != null`
    // check did. Pinned rather than left to assumption, because "46265.83" is
    // actively misleading in a prompt — worse than a dropped field. Fixing it
    // means reading the formatted text (cell.w) for this column, which is a
    // separate change with its own blast radius.
    const rows = makeHouseholdRows([
      ['Renewal date', new Date('2026-09-01'), null, null],
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [], rows);
    const result = parseTemplate(buf);

    expect(Object.keys(result.household)).toEqual(['Renewal date']);
    expect(result.household['Renewal date']).toMatch(/^\d+(\.\d+)?$/);
    expect(result.household['Renewal date']).not.toContain('2026');
  });

  it('a blank answer column yields no keys at all — not one per labelled row', () => {
    const rows = makeHouseholdRows([
      ['Household name / Nom du ménage', null, 'Smith', null],
      ['Province', null, 'Quebec', 'Important for tax context'],
    ]);
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [], rows);
    const result = parseTemplate(buf);

    // col 2 is the Example column and must never be mistaken for an answer.
    expect(result.household).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The SHIPPED template — asserted against the real file on disk, not a
// fixture. A fixture can drift from the artifact users actually download;
// these assertions cannot.
// ---------------------------------------------------------------------------

describe('the shipped public/phare_template.xlsx', () => {
  const shippedPath = path.resolve(process.cwd(), 'public', 'phare_template.xlsx');
  const shippedBuffer = () => fs.readFileSync(shippedPath);

  /** Column-0 labels from the Household sheet's data rows (index 3 onward). */
  function shippedHouseholdLabels(): string[] {
    const wb = XLSX.read(shippedBuffer(), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Household'], {
      header: 1, defval: null,
    }) as unknown[][];
    return rows
      .slice(3)
      .map((r) => r?.[0])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
  }

  it('defines 14 field labels, every one of them distinct', () => {
    const labels = shippedHouseholdLabels();
    expect(labels).toHaveLength(14);
    expect(new Set(labels).size).toBe(14);
  });

  it('names the two employer-province rows per member, matching the sheet\'s own Member 1 / Member 2 convention', () => {
    const labels = shippedHouseholdLabels();
    const employer = labels.filter((l) => l.toLowerCase().startsWith('employer province'));
    expect(employer).toEqual([
      "Employer province — Member 1 / Province de l'employeur — Membre 1",
      "Employer province — Member 2 / Province de l'employeur — Membre 2",
    ]);
  });

  it('parses with no header leakage and no duplicate labels', () => {
    const result = parseTemplate(shippedBuffer());
    expect(result.isValidV3).toBe(true);
    expect(result.householdDuplicateKeys).toBe(0);
    expect(result.household).not.toHaveProperty('Field / Champ');
    // The shipped file's answer column is deliberately blank — it is a form.
    expect(result.household).toEqual({});
  });

  it('stays within the prompt cap: one filled answer per label is far below MAX_HOUSEHOLD_KEYS', () => {
    // Every label answered = the largest household an unmodified template can
    // produce. Guards the caps sizing in promptInputLimits.ts, whose comment
    // records this sheet as defining 14 keys.
    expect(shippedHouseholdLabels()).toHaveLength(14);
    expect(14).toBeLessThan(MAX_HOUSEHOLD_KEYS);
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

// ---------------------------------------------------------------------------
// Goals sheet — target-date parsing (Bug 2: Excel serials were silently
// dropped, leaving the AI to invent a date from nothing)
// ---------------------------------------------------------------------------

describe('Goals sheet parsing', () => {
  it('parses an Excel date serial into a real date (the Disney/Brazil fixture bug)', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [
      ['Theme Park trip', 6000, 46753, 0],
    ]);
    const result = parseTemplate(buf);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toMatchObject({ targetDate: '2028-01-01', targetDateFlagged: false });
    expect(result.goalDateFlaggedRows).toBe(0);
  });

  it('parses "September 2026"-style text into a real date', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [
      ['Pay off credit line', 3000, 'September 2026', 500],
    ]);
    const result = parseTemplate(buf);
    expect(result.goals[0]).toMatchObject({ targetDate: '2026-09-01', targetDateFlagged: false });
  });

  it('flags an unparseable, non-empty date rather than silently dropping it to blank', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [
      ['Ambiguous goal', 1000, 'Jan-28', 0],
    ]);
    const result = parseTemplate(buf);
    expect(result.goals[0].targetDate).toBeNull();
    expect(result.goals[0].targetDateFlagged).toBe(true);
    expect(result.goalDateFlaggedRows).toBe(1);
  });

  it('treats a genuinely blank date cell as dateless, not flagged', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [
      ['No date yet', 1000, null, 0],
    ]);
    const result = parseTemplate(buf);
    expect(result.goals[0]).toMatchObject({ targetDate: null, targetDateFlagged: false });
    expect(result.goalDateFlaggedRows).toBe(0);
  });

  it('is unaffected by the presence of an extra "Monthly contribution" column (col 4)', () => {
    const buf = buildWorkbook(DEFAULT_INCOME_ROWS, DEFAULT_EXPENSE_ROWS, [
      ['Disney', 6000, 46753, 0, 250],
      ['Brazil', 3000, 47115, 0, null],
    ]);
    const result = parseTemplate(buf);
    expect(result.isValidV3).toBe(true);
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0].targetDate).toBe('2028-01-01');
    expect(result.goals[1].targetDate).toBe('2028-12-28');
  });
});

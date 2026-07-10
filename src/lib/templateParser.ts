/**
 * Phare Template Parser
 * ---------------------
 * Parses the official Phare budget template (phare_template.xlsx).
 *
 * Because we control the template's structure, we can parse it exactly —
 * every number traces to a known sheet and column. No AI, no guessing.
 *
 * Expected sheets: Household, Monthly Income, Fixed Expenses,
 * Variable Expenses, Annual Expenses, Goals.
 *
 * There is exactly one supported layout — v3 — and exactly one parser for
 * it. There is no installed base of pre-v3 templates to support (no launch
 * has happened), so tolerating older layouts would only be untested surface
 * area for a failure mode we already paid to fix once: a wrong-version
 * upload "succeeding" with monthly-collapsed, silently wrong numbers.
 * The contract is exact-match-or-refuse — isValidV3Template() decides which,
 * and parseTemplate() never partially parses a file that fails it.
 *
 *   Monthly Income:  col 0 = source name, col 1 = amount per paycheque,
 *                     col 2 = frequency string (required — an unrecognised
 *                     or missing value skips the row and counts it),
 *                     col 3 = member name (optional — whose income this is)
 *   Fixed Expenses:   col 0 = expense name, col 1 = category, col 2 = amount
 *                     per payment, col 3 = frequency string (blank = monthly
 *                     — unlike income, which requires an explicit value),
 *                     col 4 = account, col 5 = notes
 *
 * Version signal: a header row whose Frequency column (col 2 for income,
 * col 3 for expenses) contains "Frequency" or "Fréquence" (case-insensitive,
 * substring match so the bilingual combined header "Frequency / Fréquence"
 * matches too). Both sheets must show this signal for the file to be valid.
 */

import * as XLSX from 'xlsx';
import { monthlyEquivalent, IncomeFrequency } from './incomeHelpers';

export interface ParsedLine {
  label: string;
  amount: number;           // monthly equivalent — always safe to sum
  rawAmount?: number;       // per-payment amount (income / fixed expenses)
  frequency?: IncomeFrequency; // payment frequency (income / fixed expenses)
  member?: string;          // "Member / Membre" column (income rows only)
}

export interface SinkingFundLine {
  label: string;
  annualAmount: number;
  monthlyProvision: number;
  dueMonth: string;
}

export interface GoalLine {
  name: string;
  targetAmount: number;
  targetDate: string;
  savedSoFar: number;
}

export interface TemplateParseResult {
  isTemplate: boolean;    // the 6 required sheets are present
  isValidV3: boolean;     // both Frequency columns are present — false means refuse, never partially parse
  incomeSkippedRows: number;         // rows with an unrecognised frequency string
  fixedExpenseSkippedRows: number;   // rows with an unrecognised, non-blank frequency string
  household: Record<string, string>;
  income: { lines: ParsedLine[]; total: number };
  fixedExpenses: { lines: ParsedLine[]; total: number };
  variableExpenses: { lines: ParsedLine[]; total: number };
  sinkingFunds: { lines: SinkingFundLine[]; annualTotal: number; monthlyTotal: number };
  goals: GoalLine[];
  summary: {
    monthlyIncome: number;
    monthlyExpenses: number;
    netCashFlow: number;
  };
}

const TEMPLATE_SHEETS = [
  'Household',
  'Monthly Income',
  'Fixed Expenses',
  'Variable Expenses',
  'Annual Expenses',
  'Goals',
];

// Data rows start at row index 5 in the Monthly Income sheet; rows 0–4 are
// the header area that must carry the Frequency column signal (col 2).
const INCOME_DATA_START_ROW = 5;
const INCOME_FREQUENCY_COL = 2;

// Data rows start at row index 3 in the Fixed Expenses sheet — row 2 holds
// the column-label header row. Rows 0–2 are the header area that must carry
// the Frequency column signal (col 3).
const FIXED_EXPENSE_DATA_START_ROW = 3;
const FIXED_EXPENSE_FREQUENCY_COL = 3;

/**
 * Detect whether an uploaded workbook is the Phare template
 * by checking for the expected sheet names.
 */
export function isPhareTemplate(sheetNames: string[]): boolean {
  return TEMPLATE_SHEETS.every((s) => sheetNames.includes(s));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Convert a sheet to an array of row arrays (cells).
function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
}

function hasFrequencySignal(cell: unknown): boolean {
  if (typeof cell !== 'string') return false;
  const v = cell.toLowerCase().trim();
  return v.includes('frequency') || v.includes('fréquence') || v.includes('frequence');
}

/**
 * Scans a sheet's header area (rows 0 through headerRowCount − 1) for the
 * Frequency column signal at `col`. This is the ONLY thing that
 * distinguishes a v3 template from anything else — no per-row inference is
 * ever performed, so a data cell that happens to contain a frequency-like
 * word can never flip this.
 */
function hasFrequencyHeader(rows: unknown[][], col: number, headerRowCount: number): boolean {
  for (let i = 0; i < Math.min(headerRowCount, rows.length); i++) {
    const row = rows[i];
    if (row && hasFrequencySignal(row[col])) return true;
  }
  return false;
}

/**
 * True only for a file that is both Phare-shaped (right sheets) and v3
 * (both Frequency columns present). Anything else must be refused, never
 * partially parsed — an outdated template silently collapsed to "monthly"
 * is the exact wrong-plan failure this contract exists to prevent.
 */
export function isValidV3Template(workbook: XLSX.WorkBook): boolean {
  if (!isPhareTemplate(workbook.SheetNames)) return false;
  const incomeRows = sheetRows(workbook.Sheets['Monthly Income']);
  const fixedRows = sheetRows(workbook.Sheets['Fixed Expenses']);
  return (
    hasFrequencyHeader(incomeRows, INCOME_FREQUENCY_COL, INCOME_DATA_START_ROW) &&
    hasFrequencyHeader(fixedRows, FIXED_EXPENSE_FREQUENCY_COL, FIXED_EXPENSE_DATA_START_ROW)
  );
}

/**
 * Map a string data-cell value to an IncomeFrequency.
 * Exported so tests can verify accepted strings directly.
 */
export function parseFrequencyCell(value: unknown): IncomeFrequency | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase().trim();

  if (v === 'weekly' || v === 'hebdomadaire') return 'weekly';
  if (
    v === 'bi-weekly' || v === 'biweekly' || v === 'bi weekly' ||
    v === 'bi-hebdomadaire' || v === 'toutes les 2 semaines'
  ) return 'biweekly';
  if (
    v === 'semi-monthly' || v === 'semimonthly' || v === 'semi monthly' ||
    v === 'deux fois par mois' || v === 'semi-mensuel'
  ) return 'semimonthly';
  if (v === 'monthly' || v === 'mensuel' || v === 'mensuelle') return 'monthly';

  return null;
}

/**
 * Map a Fixed Expenses frequency cell to an IncomeFrequency. Unlike income
 * (parseFrequencyCell), a blank/missing cell here means "monthly" — most
 * fixed expenses are monthly, and requiring an explicit "monthly" in every
 * row would be needless friction. A non-blank but unrecognised string is
 * still rejected (null) — guessing a cadence from garbage input is worse
 * than asking, same principle as income.
 */
export function parseExpenseFrequencyCell(value: unknown): IncomeFrequency | null {
  if (value == null) return 'monthly';
  if (typeof value === 'string' && !value.trim()) return 'monthly';
  return parseFrequencyCell(value);
}

/**
 * Parse data rows of the Monthly Income sheet.
 * col 1 is the paycheque amount; col 2 is the frequency string (required —
 * an unrecognised or missing value skips the row and counts it); col 3 is
 * the optional member name.
 */
function parseIncome(
  rows: unknown[][],
  startRow: number,
  skipWords: string[],
): { lines: ParsedLine[]; skippedCount: number } {
  const items: ParsedLine[] = [];
  let skippedCount = 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const label = row[0];
    if (typeof label !== 'string' || !label.trim()) continue;

    const low = label.toLowerCase();
    if (skipWords.some((w) => low.includes(w))) continue;

    const rawAmount = row[1];
    const freq = parseFrequencyCell(row[2]);
    if (freq === null) {
      // Row has a label but an unrecognised (or missing) frequency — data entry error.
      skippedCount++;
      continue;
    }
    const memberCell = row[3];
    const member = typeof memberCell === 'string' && memberCell.trim() ? memberCell.trim() : undefined;
    if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount !== 0) {
      const monthly = monthlyEquivalent(rawAmount, freq);
      items.push({ label: label.trim(), amount: monthly, rawAmount, frequency: freq, member });
    }
  }

  return { lines: items, skippedCount };
}

/**
 * Parse data rows of the Fixed Expenses sheet.
 * col 2 is the per-payment amount; col 3 is the frequency string (blank =
 * monthly). A non-blank, unrecognised frequency string is skipped and
 * counted — same treatment as an income row with a bad frequency string.
 */
function parseFixedExpenses(
  rows: unknown[][],
  startRow: number,
  skipWords: string[],
): { lines: ParsedLine[]; skippedCount: number } {
  const items: ParsedLine[] = [];
  let skippedCount = 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const label = row[0];
    if (typeof label !== 'string' || !label.trim()) continue;

    const low = label.toLowerCase();
    if (skipWords.some((w) => low.includes(w))) continue;

    const rawAmount = row[2];
    const freq = parseExpenseFrequencyCell(row[3]);
    if (freq === null) {
      // Row has a label but an unrecognised, non-blank frequency — data entry error.
      skippedCount++;
      continue;
    }
    if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount !== 0) {
      const monthly = monthlyEquivalent(rawAmount, freq);
      items.push({ label: label.trim(), amount: monthly, rawAmount, frequency: freq });
    }
  }

  return { lines: items, skippedCount };
}

/**
 * Generic section parser: from `startRow`, take the label at `labelCol`
 * and the numeric amount at `amountCol`. Skips rows whose label contains
 * any skip word (headers, titles) and rows with zero/blank amounts.
 */
export function parseSection(
  rows: unknown[][],
  labelCol: number,
  amountCol: number,
  startRow: number,
  skipWords: string[]
): ParsedLine[] {
  const items: ParsedLine[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = row[labelCol];
    const amount = row[amountCol];
    if (
      typeof label === 'string' &&
      label.trim() &&
      typeof amount === 'number' &&
      Number.isFinite(amount) &&
      amount !== 0
    ) {
      const low = label.toLowerCase();
      if (!skipWords.some((w) => low.includes(w))) {
        items.push({ label: label.trim(), amount });
      }
    }
  }
  return items;
}

/**
 * Parses a workbook already confirmed to be a valid v3 template (via
 * isValidV3Template). Callers MUST check that first — this function does
 * not re-check and does not degrade; it assumes the v3 column layout.
 */
export function parseTemplate(buffer: Buffer): TemplateParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const names = workbook.SheetNames;

  if (!isPhareTemplate(names)) {
    return emptyResult(false, false);
  }
  if (!isValidV3Template(workbook)) {
    return emptyResult(true, false);
  }

  // --- Household info (label in col 0, answer in col 1) ---
  const household: Record<string, string> = {};
  const hhRows = sheetRows(workbook.Sheets['Household']);
  for (const row of hhRows) {
    const key = row[0];
    const val = row[1];
    if (typeof key === 'string' && key.trim() && val != null && String(val).trim()) {
      household[key.trim()] = String(val).trim();
    }
  }

  // --- Income ---
  const incomeRows = sheetRows(workbook.Sheets['Monthly Income']);
  const { lines: income, skippedCount: incomeSkippedRows } = parseIncome(
    incomeRows, INCOME_DATA_START_ROW, ['source', 'income', 'revenu'],
  );

  // --- Fixed expenses ---
  const fixedRows = sheetRows(workbook.Sheets['Fixed Expenses']);
  const { lines: fixed, skippedCount: fixedExpenseSkippedRows } = parseFixedExpenses(
    fixedRows, FIXED_EXPENSE_DATA_START_ROW, ['expense', 'dépense'],
  );

  // --- Variable expenses: budget in col 1, from row index 3 ---
  const varRows = sheetRows(workbook.Sheets['Variable Expenses']);
  const variable = parseSection(varRows, 0, 1, 3, ['category', 'catég']);

  // --- Annual expenses / sinking funds: annual in col 1, due month col 3, from row index 5 ---
  const annualRows = sheetRows(workbook.Sheets['Annual Expenses']);
  const sinkingLines: SinkingFundLine[] = [];
  for (let i = 5; i < annualRows.length; i++) {
    const row = annualRows[i];
    if (!row) continue;
    const label = row[0];
    const annual = row[1];
    const dueMonth = row[3];
    if (
      typeof label === 'string' &&
      label.trim() &&
      label.toUpperCase() !== 'TOTAL' &&
      typeof annual === 'number' &&
      Number.isFinite(annual) &&
      annual !== 0
    ) {
      sinkingLines.push({
        label: label.trim(),
        annualAmount: annual,
        monthlyProvision: round(annual / 12),
        dueMonth: typeof dueMonth === 'string' ? dueMonth.trim() : '',
      });
    }
  }

  // --- Goals: target col 1, date col 2, saved col 3, from row index 2 ---
  const goalRows = sheetRows(workbook.Sheets['Goals']);
  const goals: GoalLine[] = [];
  for (let i = 2; i < goalRows.length; i++) {
    const row = goalRows[i];
    if (!row) continue;
    const name = row[0];
    const target = row[1];
    if (typeof name === 'string' && name.trim() && typeof target === 'number' && target !== 0) {
      goals.push({
        name: name.trim(),
        targetAmount: target,
        targetDate: typeof row[2] === 'string' ? (row[2] as string).trim() : '',
        savedSoFar: typeof row[3] === 'number' ? (row[3] as number) : 0,
      });
    }
  }

  const incomeTotal = round(income.reduce((s, l) => s + l.amount, 0));
  const fixedTotal = round(fixed.reduce((s, l) => s + l.amount, 0));
  const variableTotal = round(variable.reduce((s, l) => s + l.amount, 0));
  const sinkingAnnual = round(sinkingLines.reduce((s, l) => s + l.annualAmount, 0));
  const sinkingMonthly = round(sinkingAnnual / 12);
  const monthlyExpenses = round(fixedTotal + variableTotal + sinkingMonthly);

  return {
    isTemplate: true,
    isValidV3: true,
    incomeSkippedRows,
    fixedExpenseSkippedRows,
    household,
    income: { lines: income, total: incomeTotal },
    fixedExpenses: { lines: fixed, total: fixedTotal },
    variableExpenses: { lines: variable, total: variableTotal },
    sinkingFunds: { lines: sinkingLines, annualTotal: sinkingAnnual, monthlyTotal: sinkingMonthly },
    goals,
    summary: {
      monthlyIncome: incomeTotal,
      monthlyExpenses,
      netCashFlow: round(incomeTotal - monthlyExpenses),
    },
  };
}

function emptyResult(isTemplate: boolean, isValidV3: boolean): TemplateParseResult {
  return {
    isTemplate,
    isValidV3,
    incomeSkippedRows: 0,
    fixedExpenseSkippedRows: 0,
    household: {},
    income: { lines: [], total: 0 },
    fixedExpenses: { lines: [], total: 0 },
    variableExpenses: { lines: [], total: 0 },
    sinkingFunds: { lines: [], annualTotal: 0, monthlyTotal: 0 },
    goals: [],
    summary: { monthlyIncome: 0, monthlyExpenses: 0, netCashFlow: 0 },
  };
}

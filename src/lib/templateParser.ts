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
 * Income parsing supports two layouts. Version is detected ONCE from the
 * header rows (0–4) of the Monthly Income sheet before any data row is read.
 * No per-row version inference is ever performed.
 *
 *   v1 (legacy): col 0 = source name, col 2 = pre-computed monthly amount
 *   v2 (current): col 0 = source name, col 1 = paycheque amount, col 2 = frequency string,
 *                 col 3 = member name (optional — whose income this is)
 *                 → code calls monthlyIncomeEquivalent() to get the monthly figure
 *
 * Version signal: a header row whose col 2 is exactly "Frequency" or "Fréquence"
 * (case-insensitive) means v2.  Anything else means v1.  This is an unambiguous
 * structural marker — it lives in the template's column-label row, not in data cells.
 *
 * Why this matters: a per-row heuristic (the approach that was here before) could
 * silently misparse a v1 template if a data cell in col 2 happened to contain a
 * frequency-like word (e.g. a description "Salary – paid monthly").  That would
 * pick up col 1 as the paycheque amount instead of col 2 as the monthly total —
 * the exact silent-wrong-income failure this build exists to prevent.
 */

import * as XLSX from 'xlsx';
import { monthlyIncomeEquivalent, IncomeFrequency } from './incomeHelpers';

export type IncomeSheetVersion = 'v1' | 'v2';

export interface ParsedLine {
  label: string;
  amount: number;           // monthly equivalent — always safe to sum
  rawAmount?: number;       // paycheque amount (v2 only)
  frequency?: IncomeFrequency; // pay frequency (v2 only)
  member?: string;          // "Member / Membre" column (v2 income rows only)
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
  isTemplate: boolean;
  incomeLayout: IncomeSheetVersion; // which column layout was detected and used
  incomeSkippedRows: number;         // v2 rows with an unrecognised frequency string — always 0 in v1 mode
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

// Data rows start at row index 5 in the Monthly Income sheet.
// Rows 0–4 are the header area we inspect for the version marker.
const INCOME_DATA_START_ROW = 5;

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

/**
 * Determine which income column layout to use by inspecting the header area
 * (rows 0 through INCOME_DATA_START_ROW − 1) of the Monthly Income sheet.
 *
 * A header row whose col 2 is exactly "Frequency" or "Fréquence"
 * (case-insensitive, trimmed) is the v2 marker.  Everything else is v1.
 *
 * This function is exported so it can be unit-tested directly.
 */
export function detectIncomeSheetVersion(rows: unknown[][]): IncomeSheetVersion {
  for (let i = 0; i < Math.min(INCOME_DATA_START_ROW, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const col2 = row[2];
    if (typeof col2 === 'string') {
      const v = col2.toLowerCase().trim();
      // Use includes() so the bilingual combined header "Frequency / Fréquence"
      // (and any future variant) is matched, not just the bare single-language word.
      if (v.includes('frequency') || v.includes('fréquence') || v.includes('frequence')) {
        return 'v2';
      }
    }
  }
  return 'v1';
}

/**
 * Map a string data-cell value to an IncomeFrequency.
 * Used only in v2 mode on DATA rows (never on header rows and never for version detection).
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
 * Parse data rows of the Monthly Income sheet using the pre-determined version.
 * No version inference is performed here — version was already decided by the header.
 *
 * v1: col 2 is the monthly amount (user pre-computed). Col 1 is ignored.
 * v2: col 1 is the paycheque amount; col 2 is the frequency string.
 *     If col 2 is not a valid frequency string, the row is skipped and counted.
 *
 * Returns parsed lines plus a count of v2 rows that were skipped due to an
 * unrecognised frequency string (always 0 in v1 mode).
 */
function parseIncome(
  rows: unknown[][],
  version: IncomeSheetVersion,
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

    if (version === 'v2') {
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
        const monthly = monthlyIncomeEquivalent(rawAmount, freq);
        items.push({ label: label.trim(), amount: monthly, rawAmount, frequency: freq, member });
      }
    } else {
      // v1: col 2 is the monthly amount
      const amount = row[2];
      if (typeof amount === 'number' && Number.isFinite(amount) && amount !== 0) {
        items.push({ label: label.trim(), amount });
      }
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

export function parseTemplate(buffer: Buffer): TemplateParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const names = workbook.SheetNames;

  if (!isPhareTemplate(names)) {
    return emptyResult(false);
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

  // --- Income: version detected from header rows ONCE, then applied to all data rows ---
  const incomeRows = sheetRows(workbook.Sheets['Monthly Income']);
  const incomeLayout = detectIncomeSheetVersion(incomeRows);
  const { lines: income, skippedCount: incomeSkippedRows } = parseIncome(
    incomeRows, incomeLayout, INCOME_DATA_START_ROW, ['source', 'income', 'revenu'],
  );

  // --- Fixed expenses: amount in col 2, from row index 2 ---
  const fixedRows = sheetRows(workbook.Sheets['Fixed Expenses']);
  const fixed = parseSection(fixedRows, 0, 2, 2, ['expense', 'dépense']);

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
    incomeLayout,
    incomeSkippedRows,
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

function emptyResult(isTemplate: boolean): TemplateParseResult {
  return {
    isTemplate,
    incomeLayout: 'v1',
    incomeSkippedRows: 0,
    household: {},
    income: { lines: [], total: 0 },
    fixedExpenses: { lines: [], total: 0 },
    variableExpenses: { lines: [], total: 0 },
    sinkingFunds: { lines: [], annualTotal: 0, monthlyTotal: 0 },
    goals: [],
    summary: { monthlyIncome: 0, monthlyExpenses: 0, netCashFlow: 0 },
  };
}

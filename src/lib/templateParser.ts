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
 * Income parsing supports two layouts:
 *   Legacy (v1): col 0 = source, col 2 = monthly amount (user pre-computed)
 *   Current (v2): col 0 = source, col 1 = paycheque amount, col 2 = frequency string
 *                 → code computes monthly equivalent via monthlyIncomeEquivalent()
 *
 * The v2 layout is detected automatically: if col 2 is a recognized frequency
 * string (weekly/bi-weekly/semi-monthly/monthly in EN or FR), v2 is used.
 * Otherwise the row falls back to v1 (col 2 as monthly amount).
 */

import * as XLSX from 'xlsx';
import { monthlyIncomeEquivalent, IncomeFrequency } from './incomeHelpers';

export interface ParsedLine {
  label: string;
  amount: number;          // monthly equivalent — always safe to sum
  rawAmount?: number;      // paycheque amount (v2 only)
  frequency?: IncomeFrequency; // pay frequency (v2 only)
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
 * Map a string cell value to an IncomeFrequency if it's a recognized keyword.
 * Supports both English and French labels used in the v2 template.
 */
function detectFrequency(value: unknown): IncomeFrequency | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase().trim();

  if (v === 'weekly' || v === 'hebdomadaire') return 'weekly';
  if (v === 'bi-weekly' || v === 'biweekly' || v === 'bi-hebdomadaire' || v === 'toutes les 2 semaines')
    return 'biweekly';
  if (v === 'semi-monthly' || v === 'semimonthly' || v === 'deux fois par mois' || v === 'semi-mensuel')
    return 'semimonthly';
  if (v === 'monthly' || v === 'mensuel' || v === 'mensuelle') return 'monthly';

  return null;
}

/**
 * Parse the Monthly Income sheet.
 *
 * Supports both v1 (monthly amount in col 2) and v2 (paycheque amount in col 1,
 * frequency string in col 2) per-row — a mixed workbook is safe.
 */
function parseIncome(rows: unknown[][], startRow: number, skipWords: string[]): ParsedLine[] {
  const items: ParsedLine[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const label = row[0];
    if (typeof label !== 'string' || !label.trim()) continue;

    const low = label.toLowerCase();
    if (skipWords.some((w) => low.includes(w))) continue;

    const freq = detectFrequency(row[2]);

    if (freq !== null) {
      // v2 layout: col 1 = paycheque amount, col 2 = frequency
      const rawAmount = row[1];
      if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount !== 0) {
        const monthly = monthlyIncomeEquivalent(rawAmount, freq);
        items.push({ label: label.trim(), amount: monthly, rawAmount, frequency: freq });
      }
    } else {
      // v1 layout: col 2 = monthly amount (user pre-computed)
      const amount = row[2];
      if (typeof amount === 'number' && Number.isFinite(amount) && amount !== 0) {
        items.push({ label: label.trim(), amount });
      }
    }
  }

  return items;
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

  // --- Income: supports v1 (col 2 = monthly) and v2 (col 1 = paycheque, col 2 = frequency) ---
  const incomeRows = sheetRows(workbook.Sheets['Monthly Income']);
  const income = parseIncome(incomeRows, 5, ['source', 'income', 'revenu']);

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
    household: {},
    income: { lines: [], total: 0 },
    fixedExpenses: { lines: [], total: 0 },
    variableExpenses: { lines: [], total: 0 },
    sinkingFunds: { lines: [], annualTotal: 0, monthlyTotal: 0 },
    goals: [],
    summary: { monthlyIncome: 0, monthlyExpenses: 0, netCashFlow: 0 },
  };
}

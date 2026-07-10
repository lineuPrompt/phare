import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { NextRequest } from 'next/server';
import { POST } from '../route';

// ---------------------------------------------------------------------------
// /api/upload never touches Supabase — it's a pure parse-or-refuse endpoint
// — so these tests just build real xlsx buffers and POST them, no mocking.
// ---------------------------------------------------------------------------

function addSheet(wb: XLSX.WorkBook, name: string, data: unknown[][] = []) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data as XLSX.CellObject[][], { cellDates: false }), name);
}

const V3_INCOME_ROWS = [
  [null, null, null, null],
  [null, null, null, null],
  [null, null, null, null],
  [null, null, null, null],
  ['Source', 'Amount per paycheque / Montant par paie', 'Frequency / Fréquence', 'Member / Membre'],
  ['Salary', 2397.85, 'bi-weekly', 'Lineu'],
];

const V3_EXPENSE_ROWS = [
  ['FIXED MONTHLY EXPENSES / DÉPENSES FIXES MENSUELLES'],
  [null],
  ['Expense / Dépense', 'Category / Catégorie', 'Amount per payment / Montant par paiement', 'Frequency / Fréquence', 'Account / Compte', 'Notes'],
  ['Mortgage', 'Housing', 1500, 'bi-weekly', 'Chequing', null],
];

// The pre-v3 Fixed Expenses layout: no Frequency column at all.
const V2_EXPENSE_ROWS = [
  ['FIXED MONTHLY EXPENSES'],
  [null],
  ['Expense / Dépense', 'Category / Catégorie', 'Amount / Montant', 'Account / Compte', 'Notes'],
  ['Mortgage', 'Housing', 1500, 'Chequing', null],
];

function buildTemplateBuffer(incomeRows: unknown[][], expenseRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  addSheet(wb, 'Household');
  addSheet(wb, 'Monthly Income', incomeRows);
  addSheet(wb, 'Fixed Expenses', expenseRows);
  addSheet(wb, 'Variable Expenses', [[], [], [], ['Groceries', 800]]);
  addSheet(wb, 'Annual Expenses', [[], [], [], [], [], ['Car Insurance', 1200, null, 'March']]);
  addSheet(wb, 'Goals');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

function postFile(buffer: Buffer, filename = 'template.xlsx') {
  const formData = new FormData();
  formData.append('file', new File([new Uint8Array(buffer)], filename));
  return POST(new Request('http://localhost/api/upload', { method: 'POST', body: formData }) as unknown as NextRequest);
}

describe('POST /api/upload — exact-match-or-refuse contract', () => {
  it('a valid v3 template is parsed', async () => {
    const buf = buildTemplateBuffer(V3_INCOME_ROWS, V3_EXPENSE_ROWS);
    const res = await postFile(buf);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.source).toBe('template');
    expect(json.parsed.isValidV3).toBe(true);
    expect(json.parsed.fixedExpenses.lines).toEqual([
      { label: 'Mortgage', amount: 3250, rawAmount: 1500, frequency: 'biweekly' },
    ]);
  });

  it("a v2-shaped file (no expense Frequency column) is refused with 'outdated_template', not parsed as monthly", async () => {
    const buf = buildTemplateBuffer(V3_INCOME_ROWS, V2_EXPENSE_ROWS);
    const res = await postFile(buf);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.source).toBe('template_mismatch');
    expect(json.reason).toBe('outdated_template');
    // Never partially parsed — no plan-affecting numbers should leak through.
    expect(json.parsed).toBeUndefined();
  });

  it('a completely unrelated spreadsheet is refused with wrong_file', async () => {
    const wb = XLSX.utils.book_new();
    addSheet(wb, 'Sheet1', [['unrelated', 'data']]);
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
    const res = await postFile(buf);
    const json = await res.json();

    expect(json.source).toBe('template_mismatch');
    expect(json.reason).toBe('wrong_file');
  });

  it('rejects a non-xlsx file extension outright', async () => {
    const res = await postFile(Buffer.from('a,b,c\n1,2,3'), 'data.csv');
    expect(res.status).toBe(400);
  });

  it('rejects when no file is provided', async () => {
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: new FormData() }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// FUNNEL (2026-09-29): /api/upload records every refusal of a signed-in
// household's file as onboarding_upload_rejected { reason } — in after(), so
// never on the user's path — and records nothing when the file is accepted.
//
// after() is captured, not run: the tests prove the row does not exist when
// the response is returned, and only appears once the callbacks drain.
// ---------------------------------------------------------------------------

const { afterCallbacks, parser } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
  parser: { throws: false },
}));

// parse_failed is the route's catch-all: a file that IS the v3 template but
// that the parser then chokes on. Forced here; real bytes that break the
// parser are not something to rely on finding.
vi.mock('@/lib/templateParser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/templateParser')>();
  return {
    ...actual,
    parseTemplate: (...a: Parameters<typeof actual.parseTemplate>) => {
      if (parser.throws) throw new Error('simulated parser failure');
      return actual.parseTemplate(...a);
    },
  };
});

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => { afterCallbacks.push(fn); } };
});

vi.mock('@/lib/supabase-server', async () => {
  const { supabaseServerMock } = await import('@/lib/__tests__/helpers/onboardingSessionMock');
  return supabaseServerMock();
});

const { reservedEvents } = await import('@/lib/__tests__/helpers/onboardingSessionMock');
const { POST } = await import('../route');

async function drainAfter() {
  const pending = afterCallbacks.splice(0, afterCallbacks.length);
  for (const fn of pending) await fn();
}

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as XLSX.CellObject[][]), name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

const TEMPLATE_SHEETS = (expenseRows: unknown[][]) => ({
  Household: [],
  'Monthly Income': [[], [], [], [], ['Source', 'Amount per paycheque / Montant par paie', 'Frequency / Fréquence', 'Member / Membre'], ['Salary', 2397.85, 'bi-weekly', 'Lineu']],
  'Fixed Expenses': expenseRows,
  'Variable Expenses': [[], [], [], ['Groceries', 800]],
  'Annual Expenses': [[], [], [], [], [], ['Car Insurance', 1200, null, 'March']],
  Goals: [],
});
const V3_FIXED = [['FIXED'], [null], ['Expense / Dépense', 'Category / Catégorie', 'Amount per payment / Montant par paiement', 'Frequency / Fréquence', 'Account / Compte', 'Notes'], ['Mortgage', 'Housing', 1500, 'bi-weekly', 'Chequing', null]];
const V2_FIXED = [['FIXED'], [null], ['Expense / Dépense', 'Category / Catégorie', 'Amount / Montant', 'Account / Compte', 'Notes'], ['Mortgage', 'Housing', 1500, 'Chequing', null]];

function post(buffer: Buffer | null, filename = 'template.xlsx', headers: Record<string, string> = {}) {
  const formData = new FormData();
  if (buffer) formData.append('file', new File([new Uint8Array(buffer)], filename));
  return POST(new Request('http://localhost/api/upload', { method: 'POST', body: formData, headers }) as unknown as NextRequest);
}

const rejections = () => reservedEvents.filter((e) => e.event_type === 'onboarding_upload_rejected');

describe('POST /api/upload — onboarding_upload_rejected', () => {
  beforeEach(() => {
    reservedEvents.splice(0, reservedEvents.length);
    afterCallbacks.splice(0, afterCallbacks.length);
    parser.throws = false;
  });

  it.each([
    ['wrong_file', () => post(workbook({ Sheet1: [['unrelated']] }))],
    ['outdated_template', () => post(workbook(TEMPLATE_SHEETS(V2_FIXED)))],
    ['unsupported_type', () => post(Buffer.from('a,b\n1,2'), 'data.csv')],
    ['no_file', () => post(null)],
    ['parse_failed', () => { parser.throws = true; return post(workbook(TEMPLATE_SHEETS(V3_FIXED))); }],
  ])('%s: recorded after the response, household-scoped, reason only', async (reason, send) => {
    const res = await send();
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(rejections()).toEqual([]); // not written on the user's path

    await drainAfter();
    expect(rejections()).toEqual([{
      household_id: 'test-household',
      user_id: 'test-user',
      event_type: 'onboarding_upload_rejected',
      metadata: { reason, platform: 'web' },
    }]);
  });

  it('a bearer-token caller (the app) is recorded as platform mobile', async () => {
    await post(workbook({ Sheet1: [['unrelated']] }), 'x.xlsx', { Authorization: 'Bearer abc.def.ghi' });
    await drainAfter();
    expect(rejections()[0].metadata).toEqual({ reason: 'wrong_file', platform: 'mobile' });
  });

  it('an accepted template records no rejection', async () => {
    const res = await post(workbook(TEMPLATE_SHEETS(V3_FIXED)));
    expect((await res.json()).source).toBe('template');
    await drainAfter();
    expect(rejections()).toEqual([]);
  });
});

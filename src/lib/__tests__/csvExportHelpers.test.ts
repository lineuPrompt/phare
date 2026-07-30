import { describe, it, expect } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {
  buildTransactionsCsv,
  buildCsvLine,
  escapeCsvCell,
  exportFilename,
  exportLabels,
  COLUMN_ORDER,
  UTF8_BOM,
  type CsvLabels,
  type ExportTx,
} from '../csvExportHelpers';

const LABELS: CsvLabels = {
  headers: [...COLUMN_ORDER],
  yes: 'Yes',
  no: 'No',
  types: { expense: 'Expense', income: 'Income', transfer: 'Transfer' },
  sources: { manual: 'Entered by hand', bridge: 'Created by Phare' },
};

function tx(overrides: Partial<ExportTx> = {}): ExportTx {
  return {
    date: '2026-07-30',
    amount: 100,
    type: 'expense',
    description: 'Groceries',
    is_bridge: false,
    recurring_item_id: null,
    source: 'manual',
    accounts: { name: 'Chequing' },
    categories: { name: 'Groceries & Pharmacy', name_fr: null },
    ...overrides,
  };
}

function dataRows(csv: string): string[] {
  return csv.replace(UTF8_BOM, '').trimEnd().split('\r\n').slice(1);
}

function cell(csv: string, columnIndex: number, rowIndex = 0): string {
  return dataRows(csv)[rowIndex].split(',')[columnIndex];
}

describe('escapeCsvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeCsvCell('Groceries')).toBe('Groceries');
  });

  it('quotes and doubles embedded quotes, commas, and newlines', () => {
    expect(escapeCsvCell('Tim, Bob')).toBe('"Tim, Bob"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  // A description off a bank statement starting with = is executed as a
  // formula when the family opens the file. This is the actual attack.
  it('defuses formula injection in text cells', () => {
    expect(escapeCsvCell('=1+1', true)).toBe("'=1+1");
    expect(escapeCsvCell('@SUM(A1)', true)).toBe("'@SUM(A1)");
    expect(escapeCsvCell('+1234', true)).toBe("'+1234");
    expect(escapeCsvCell('=HYPERLINK("http://evil","x")', true)).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
  });

  it('does NOT prefix non-text cells — every expense amount starts with a minus', () => {
    expect(escapeCsvCell('-45.00', false)).toBe('-45.00');
    expect(escapeCsvCell('-45.00', true)).toBe("'-45.00"); // proves the flag is what protects it
  });
});

describe('buildTransactionsCsv — sign convention', () => {
  it('income is positive, expense is negative — the signs the app shows', () => {
    const csv = buildTransactionsCsv(
      [tx({ type: 'income', amount: 3200 }), tx({ type: 'expense', amount: 45.5 })],
      'en',
      LABELS
    );
    expect(cell(csv, 5, 0)).toBe('3200.00');
    expect(cell(csv, 5, 1)).toBe('-45.50');
  });

  it('a transfer contribution is an outflow', () => {
    const csv = buildTransactionsCsv([tx({ type: 'transfer', amount: 500 })], 'en', LABELS);
    expect(cell(csv, 5)).toBe('-500.00');
  });

  // The case a fourth opinion about transfers would get wrong: a debt draw is
  // stored with a negative amount, so -amount correctly reads as an inflow.
  it('a debt draw (transfer stored negative) reads positive', () => {
    const csv = buildTransactionsCsv([tx({ type: 'transfer', amount: -750 })], 'en', LABELS);
    expect(cell(csv, 5)).toBe('750.00');
  });

  it('handles amounts arriving as numeric strings from PostgREST', () => {
    const csv = buildTransactionsCsv(
      [tx({ type: 'expense', amount: '45.50' as unknown as number })],
      'en',
      LABELS
    );
    expect(cell(csv, 5)).toBe('-45.50');
  });
});

describe('buildTransactionsCsv — shape and content', () => {
  it('starts with a BOM and uses CRLF, so Excel does not mangle accents', () => {
    const csv = buildTransactionsCsv([tx()], 'en', LABELS);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits a header row even with no transactions', () => {
    const csv = buildTransactionsCsv([], 'en', LABELS);
    expect(dataRows(csv)).toEqual([]);
    expect(csv.replace(UTF8_BOM, '').split('\r\n')[0]).toBe(COLUMN_ORDER.join(','));
  });

  it('localizes the category name via the app\'s canonical helper', () => {
    const rows = [tx({ categories: { name: 'Groceries & Pharmacy', name_fr: null } })];
    expect(cell(buildTransactionsCsv(rows, 'en', LABELS), 3)).toBe('Groceries & Pharmacy');
    expect(cell(buildTransactionsCsv(rows, 'fr', LABELS), 3)).toBe('Épicerie et pharmacie');
  });

  it('renders the provenance flags', () => {
    const csv = buildTransactionsCsv(
      [tx({ is_bridge: true, recurring_item_id: 'rec-1', source: 'bridge' })],
      'en',
      LABELS
    );
    expect(cell(csv, 6)).toBe('Created by Phare');
    expect(cell(csv, 7)).toBe('Yes');
    expect(cell(csv, 8)).toBe('Yes');
  });

  it('tolerates embeds arriving as single-element arrays', () => {
    const csv = buildTransactionsCsv(
      [tx({ accounts: [{ name: 'Visa' }], categories: [{ name: 'Housing', name_fr: null }] })],
      'en',
      LABELS
    );
    expect(cell(csv, 1)).toBe('Visa');
    expect(cell(csv, 3)).toBe('Housing');
  });

  // account_id and category_id are both ON DELETE SET NULL — a deleted account
  // must leave a blank cell, not crash the export or emit "undefined".
  it('leaves blanks for a deleted account or category and a null description', () => {
    const csv = buildTransactionsCsv(
      [tx({ accounts: null, categories: null, description: null })],
      'en',
      LABELS
    );
    const cells = dataRows(csv)[0].split(',');
    expect(cells[1]).toBe('');
    expect(cells[3]).toBe('');
    expect(cells[4]).toBe('');
  });

  it('falls back to the raw token for an unmapped type or source', () => {
    const csv = buildTransactionsCsv([tx({ source: 'screenshot' })], 'en', LABELS);
    expect(cell(csv, 6)).toBe('screenshot');
  });

  it('refuses to build if the header count drifts from the column list', () => {
    expect(() => buildTransactionsCsv([tx()], 'en', { ...LABELS, headers: ['just one'] }))
      .toThrow(/does not match/);
  });
});

describe('buildCsvLine', () => {
  it('joins cells with commas, escaping each', () => {
    expect(buildCsvLine([{ value: 'a' }, { value: 'b,c' }])).toBe('a,"b,c"');
  });
});

describe('exportFilename', () => {
  it('names the file with the export date', () => {
    expect(exportFilename('2026-07-30')).toBe('phare-transactions-2026-07-30.csv');
  });
});

// The global i18nKeys test only scans `useTranslations(...)` declarations, so
// the CSV header keys — resolved server-side via getTranslations in the route —
// are invisible to it. This closes that gap explicitly.
describe('exportData i18n keys resolve in both locales', () => {
  const locales = { en, fr } as Record<string, Record<string, unknown>>;

  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  const required = [
    ...COLUMN_ORDER.map((c) => `exportData.columns.${c}`),
    'exportData.yes',
    'exportData.no',
    'exportData.title',
    'exportData.description',
    'exportData.button',
    'exportData.preparing',
    'exportData.failed',
    ...['expense', 'income', 'transfer'].map((k) => `exportData.types.${k}`),
    ...['manual', 'screenshot', 'csv', 'excel', 'bridge'].map((k) => `exportData.sources.${k}`),
  ];

  it.each(Object.keys(locales))('%s has every export key as a non-empty string', (locale) => {
    const missing = required.filter((key) => {
      const value = resolve(locales[locale], key);
      return typeof value !== 'string' || value.length === 0;
    });
    expect(missing, `missing in ${locale}.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('the French export is genuinely French, not a copy of the English', () => {
    expect(resolve(fr, 'exportData.columns.category')).toBe('Catégorie');
    expect(resolve(fr, 'exportData.types.expense')).toBe('Dépense');
    expect(resolve(fr, 'exportData.yes')).toBe('Oui');
  });
});

// exportLabels replaced next-intl's getTranslations in the route. That call
// needed a Next request context, could not be exercised here, and was one of
// the two live-failure suspects. Reading the message files directly makes the
// labels provably correct in plain unit tests.
describe('exportLabels', () => {
  it('returns one header per column, in column order, for both locales', () => {
    for (const locale of ['en', 'fr']) {
      const labels = exportLabels(locale);
      expect(labels.headers).toHaveLength(COLUMN_ORDER.length);
      expect(labels.headers.every((h) => typeof h === 'string' && h.length > 0)).toBe(true);
    }
  });

  it('is genuinely localized, not the English strings twice', () => {
    expect(exportLabels('en').yes).toBe('Yes');
    expect(exportLabels('fr').yes).toBe('Oui');
    expect(exportLabels('fr').types.expense).toBe('Dépense');
    expect(exportLabels('fr').headers).not.toEqual(exportLabels('en').headers);
  });

  it('falls back to en for an unknown locale rather than returning blank headers', () => {
    expect(exportLabels('es')).toEqual(exportLabels('en'));
  });

  it('produces a CSV that buildTransactionsCsv accepts — the header-count guard passes', () => {
    for (const locale of ['en', 'fr']) {
      expect(() => buildTransactionsCsv([], locale, exportLabels(locale))).not.toThrow();
    }
  });
});

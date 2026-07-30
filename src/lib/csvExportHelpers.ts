import { signAmount } from './timelineHelpers';
import { categoryDisplayName } from './categoryTranslations';

/**
 * CSV assembly for "export my data". Pure string work — the route does the
 * auth and the query, this decides what a row says.
 *
 * SIGN CONVENTION
 * ---------------
 * The amount column runs through timelineHelpers.signAmount, the same one
 * canonical opinion the ledger walk and planChainHelpers already share. A
 * family opening this in Excel sees the signs the app showed them, including
 * a debt draw reading positive (stored negative, transfer → -amount). There is
 * deliberately no raw-amount column: two amount columns disagreeing about a
 * transfer is exactly the confusion this avoids.
 */

export type ExportTx = {
  date: string;
  amount: number;
  type: string;
  description?: string | null;
  is_bridge?: boolean | null;
  recurring_item_id?: string | null;
  source?: string | null;
  accounts?: unknown;
  categories?: unknown;
};

export type CsvLabels = {
  /** Column headers, in COLUMN_ORDER. */
  headers: string[];
  yes: string;
  no: string;
  /** transactions.type → display. */
  types: Record<string, string>;
  /** transactions.source → display. */
  sources: Record<string, string>;
};

/** Written as an escape, not a literal, so it survives editors and diffs. */
export const UTF8_BOM = '\uFEFF';

export const COLUMN_ORDER = [
  'date',
  'account',
  'type',
  'category',
  'description',
  'amount',
  'source',
  'isBridge',
  'isRecurring',
] as const;

/**
 * PostgREST returns an embedded to-one relation as an object or as a
 * single-element array depending on how it detects the relationship. Both are
 * accepted rather than pinning one shape and silently exporting blank columns
 * if it ever changes.
 */
function embeddedOne<T>(embedded: unknown): T | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  return (row ?? null) as T | null;
}

/**
 * Escape one cell for RFC-4180 CSV.
 *
 * `isText` guards against CSV formula injection: a description a family typed
 * (or that came off a bank statement) starting with = + - @ is executed as a
 * formula by Excel and Sheets on open. Those cells get an apostrophe prefix.
 * The flag exists because the amount column legitimately starts with '-' for
 * every expense — blanket-prefixing would corrupt every negative number.
 */
export function escapeCsvCell(value: string, isText = false): string {
  let cell = value ?? '';

  if (isText && /^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }

  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function buildCsvLine(cells: { value: string; isText?: boolean }[]): string {
  return cells.map((c) => escapeCsvCell(c.value, c.isText)).join(',');
}

/**
 * Build the full CSV document.
 *
 * Emits CRLF line endings and a UTF-8 BOM. Both are for Excel specifically:
 * without the BOM, Excel on Windows reads the file as ANSI and renders every
 * French accent as mojibake — "Épicerie" becomes "Ãpicerie" — which for a
 * bilingual product makes the French export look broken on open.
 *
 * Dates stay ISO (YYYY-MM-DD) and amounts use a '.' decimal separator in both
 * locales: those are interchange formats, not display copy. Only the headers
 * and the enumerated values (type, source, yes/no) are localized.
 */
export function buildTransactionsCsv(
  rows: ExportTx[],
  locale: string,
  labels: CsvLabels
): string {
  if (labels.headers.length !== COLUMN_ORDER.length) {
    throw new Error(
      `CSV headers length ${labels.headers.length} does not match ${COLUMN_ORDER.length} columns`
    );
  }

  const lines: string[] = [
    buildCsvLine(labels.headers.map((h) => ({ value: h, isText: true }))),
  ];

  for (const tx of rows) {
    const account = embeddedOne<{ name?: string | null }>(tx.accounts);
    const category = embeddedOne<{ name: string; name_fr?: string | null }>(tx.categories);

    lines.push(
      buildCsvLine([
        { value: tx.date ?? '' },
        { value: account?.name ?? '', isText: true },
        { value: labels.types[tx.type] ?? tx.type ?? '', isText: true },
        { value: category ? categoryDisplayName(category, locale) : '', isText: true },
        { value: tx.description ?? '', isText: true },
        { value: signAmount({ type: tx.type, amount: Number(tx.amount) }).toFixed(2) },
        { value: labels.sources[tx.source ?? ''] ?? tx.source ?? '', isText: true },
        { value: tx.is_bridge ? labels.yes : labels.no, isText: true },
        { value: tx.recurring_item_id ? labels.yes : labels.no, isText: true },
      ])
    );
  }

  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/** e.g. phare-transactions-2026-07-30.csv */
export function exportFilename(today: string): string {
  return `phare-transactions-${today}.csv`;
}

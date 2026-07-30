import { describe, it, expect } from 'vitest';
import { TRANSACTIONS_EXPORT_SELECT } from '../csvExportHelpers';
import {
  parseSchema,
  parsePlainColumns,
  topLevelParts,
  findLiteralQueries,
} from './schemaFromMigrations';

/**
 * The other half of the failure class the embed test covers.
 *
 * A `.select()` naming a column that doesn't exist is not a TypeScript error —
 * it's a string. PostgREST answers with PGRST204 and the whole query fails, so
 * the feature returns nothing while every mocked unit test stays green. Same
 * shape as the PGRST201 embed bug that shipped in the CSV export: the
 * formatter was never wrong, the query was never checked.
 *
 * Source of truth is `supabase/migrations/`, replayed by the shared parser —
 * so renaming a column in a migration without updating its callers turns red
 * here rather than in a family's browser.
 */

const { columns } = parseSchema();

/** Tables a query may target that the migration parser won't know about. */
const NON_TABLE_SOURCES = new Set<string>([
  // Views, RPC-backed sources, or anything created outside supabase/migrations
  // goes here WITH a reason. Empty today — every .from() target is a real table.
]);

function offendingColumns(table: string, select: string): string[] {
  if (NON_TABLE_SOURCES.has(table)) return [];

  const known = columns.get(table);
  if (!known) return [`${table} is not a table defined in supabase/migrations`];

  return parsePlainColumns(select)
    .filter((column) => !known.has(column))
    .map((column) => `${table}.${column} does not exist (columns: ${[...known].sort().join(', ')})`);
}

describe('select columns exist in the schema', () => {
  it('parses columns out of the migrations at all', () => {
    // Vacuity guard: a parser that finds nothing would make every check below
    // pass trivially.
    expect(columns.size).toBeGreaterThan(10);

    const transactions = columns.get('transactions');
    expect(transactions).toBeDefined();
    // Spot-check one inline CREATE TABLE column and one added by a later
    // ALTER TABLE, so both parse paths are proven.
    expect(transactions!.has('amount')).toBe(true);
    expect(transactions!.has('transfer_peer_id')).toBe(true);
    expect(transactions!.has('source')).toBe(true);
  });

  it('drops a table that a later migration dropped', () => {
    // 20260728000000_drop_legacy_goals_table.sql. If `goals` survived here,
    // the parser would be accumulating stale schema.
    expect(columns.has('goals')).toBe(false);
  });

  it('splits a select without being confused by embeds', () => {
    expect(topLevelParts('id, name, accounts!account_id(name, type), month')).toEqual([
      'id',
      'name',
      'accounts!account_id(name, type)',
      'month',
    ]);
    expect(parsePlainColumns('id, accounts(name), category_id')).toEqual(['id', 'category_id']);
    expect(parsePlainColumns('alias:amount, id')).toEqual(['amount', 'id']);
  });

  // Proves the detector has teeth. Without it, everything else can be green
  // because nothing is ever flagged.
  it('rejects a column that does not exist, and an unknown table', () => {
    const bogus = offendingColumns('transactions', 'id, amount, nonexistent_column');
    expect(bogus).toHaveLength(1);
    expect(bogus[0]).toContain('transactions.nonexistent_column does not exist');

    // budgets genuinely has no `name` column — the phantom finding that the
    // first version of this scan produced by mis-pairing .from()/.select().
    expect(offendingColumns('budgets', 'id, name')).toHaveLength(1);

    expect(offendingColumns('not_a_real_table', 'id')).toEqual([
      'not_a_real_table is not a table defined in supabase/migrations',
    ]);
  });

  it('accepts the transactions export select', () => {
    expect(offendingColumns('transactions', TRANSACTIONS_EXPORT_SELECT)).toEqual([]);
  });

  it('every literal .from().select() in the codebase names only real columns', () => {
    const queries = findLiteralQueries();

    expect(queries.length).toBeGreaterThan(10);
    expect(queries.some((q) => parsePlainColumns(q.select).length > 1)).toBe(true);

    const failures = queries.flatMap(({ file, table, select }) =>
      offendingColumns(table, select).map((reason) => `${file}: .from('${table}') — ${reason}`)
    );
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });
});

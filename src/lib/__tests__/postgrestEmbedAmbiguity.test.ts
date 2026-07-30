import { describe, it, expect } from 'vitest';
import { TRANSACTIONS_EXPORT_SELECT } from '../csvExportHelpers';
import {
  parseSchema,
  buildAmbiguousPairs,
  parseEmbeds,
  findLiteralQueries,
} from './schemaFromMigrations';

/**
 * Guards the seam unit tests structurally cannot reach: whether a PostgREST
 * `.select()` embed is one the real database will accept.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * `transactions` has TWO foreign keys into `accounts` — account_id, and
 * bridge_source_account added later by the card-bridge feature. A bare
 * `accounts(name)` embed is therefore ambiguous, and PostgREST rejects the
 * ENTIRE query with PGRST201 ("Could not embed because more than one
 * relationship was found"). Not a partial result — nothing comes back.
 *
 * Every unit test around the CSV export passed, because they all fed
 * correctly-shaped fixture rows to the formatter. Nothing asserted that the
 * query producing those rows was legal. The failure is a property of the
 * schema, so it can only be caught by checking the query against the schema —
 * which is what this does, deriving the ambiguous pairs from the migrations
 * rather than hardcoding them.
 *
 * Adding a second FK into an already-embedded table is a normal migration to
 * write. This turns that into a red test instead of a feature that silently
 * returns nothing in production.
 */

const { foreignKeys } = parseSchema();
const ambiguousPairs = buildAmbiguousPairs(foreignKeys);

function offendingEmbeds(table: string, select: string): string[] {
  return parseEmbeds(select)
    .filter((embed) => ambiguousPairs.has(`${table}->${embed.table}`) && !embed.disambiguator)
    .map((embed) => {
      const columns = ambiguousPairs.get(`${table}->${embed.table}`)!;
      return `${table} → ${embed.table} is ambiguous (${columns.join(', ')}); write ${embed.table}!<column>(…)`;
    });
}

describe('PostgREST embed ambiguity', () => {
  it('parses foreign keys out of the migrations at all', () => {
    // Sanity guard: if parsing silently breaks, every assertion below passes
    // vacuously and this file becomes decoration.
    expect(foreignKeys.length).toBeGreaterThan(20);
    expect(foreignKeys).toContainEqual({ table: 'transactions', column: 'account_id', target: 'accounts' });
    expect(foreignKeys).toContainEqual({ table: 'transactions', column: 'bridge_source_account', target: 'accounts' });
  });

  it('knows transactions → accounts is the ambiguous pair that broke the export', () => {
    expect(ambiguousPairs.get('transactions->accounts')).toEqual(['account_id', 'bridge_source_account']);
  });

  it('parses embeds, aliases and disambiguators out of a select string', () => {
    expect(parseEmbeds('date, accounts!account_id(name), categories(name, name_fr)')).toEqual([
      { alias: null, table: 'accounts', disambiguator: '!account_id' },
      { alias: null, table: 'categories', disambiguator: null },
    ]);
    expect(parseEmbeds('amount, accounts:accounts!some_fkey(name, type)')).toEqual([
      { alias: 'accounts', table: 'accounts', disambiguator: '!some_fkey' },
    ]);
  });

  // Without this, everything above could be green because the detector never
  // detects anything. Pins the exact string that shipped and failed live.
  it('rejects the bare accounts(name) embed that actually shipped and broke', () => {
    const shipped =
      'date, amount, type, description, is_bridge, recurring_item_id, source, accounts(name), categories(name, name_fr)';

    const problems = offendingEmbeds('transactions', shipped);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('transactions → accounts is ambiguous');
    expect(problems[0]).toContain('account_id, bridge_source_account');
  });

  it('the transactions export select disambiguates every ambiguous embed', () => {
    expect(offendingEmbeds('transactions', TRANSACTIONS_EXPORT_SELECT)).toEqual([]);
  });

  it('no literal .from().select() in the codebase embeds an ambiguous relation bare', () => {
    const queries = findLiteralQueries();

    // Sanity guard: the scan must actually be finding queries with embeds, or
    // this passes vacuously the moment the regex or the call style drifts.
    expect(queries.length).toBeGreaterThan(10);
    expect(queries.filter((q) => q.select.includes('(')).length).toBeGreaterThan(3);

    const failures = queries.flatMap(({ file, table, select }) =>
      offendingEmbeds(table, select).map((reason) => `${file}: .from('${table}') — ${reason}`)
    );
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });
});

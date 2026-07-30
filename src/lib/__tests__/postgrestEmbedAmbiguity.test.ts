import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TRANSACTIONS_EXPORT_SELECT } from '../csvExportHelpers';

/**
 * Guards the seam that unit tests structurally cannot reach: whether a
 * PostgREST `.select()` string is one the real database will accept.
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
 * query which produces those rows was legal. The failure is a property of the
 * schema, not of any function, so it can only be caught by checking the query
 * string against the schema — which is what this does, by deriving the
 * ambiguous pairs from the migrations rather than hardcoding them.
 *
 * A second FK into an already-embedded table is a normal, low-drama migration
 * to write. This test is what turns that into a red test instead of a feature
 * that silently returns nothing in production.
 */

const REPO_ROOT = path.resolve(process.cwd());
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const SRC_DIR = path.join(REPO_ROOT, 'src');

type ForeignKey = { table: string; column: string; target: string };

function parseForeignKeys(): ForeignKey[] {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const found = new Map<string, ForeignKey>();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    let currentTable: string | null = null;

    for (const line of sql.split(/\r?\n/)) {
      const create = line.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/i);
      if (create) currentTable = create[1];

      const alter = line.match(/ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)/i);
      if (alter) currentTable = alter[1];

      // `ADD COLUMN IF NOT EXISTS foo uuid REFERENCES bar(id)` and the inline
      // `foo uuid NOT NULL REFERENCES bar(id)` form inside CREATE TABLE.
      const ref = line.match(/(?:ADD COLUMN(?:\s+IF NOT EXISTS)?\s+)?(\w+)\s+uuid\b[^,]*?REFERENCES\s+(\w+)\s*\(/i);
      if (ref && currentTable) {
        const fk = { table: currentTable, column: ref[1], target: ref[2] };
        // Keyed so a re-run CREATE TABLE IF NOT EXISTS in a later migration
        // doesn't count the same column twice.
        found.set(`${fk.table}.${fk.column}->${fk.target}`, fk);
      }
    }
  }

  return [...found.values()];
}

/** (childTable, targetTable) pairs reachable by more than one FK column. */
function buildAmbiguousPairs(fks: ForeignKey[]): Map<string, string[]> {
  const columnsByPair = new Map<string, Set<string>>();
  for (const fk of fks) {
    const key = `${fk.table}->${fk.target}`;
    if (!columnsByPair.has(key)) columnsByPair.set(key, new Set());
    columnsByPair.get(key)!.add(fk.column);
  }

  const ambiguous = new Map<string, string[]>();
  for (const [key, columns] of columnsByPair) {
    if (columns.size > 1) ambiguous.set(key, [...columns].sort());
  }
  return ambiguous;
}

type Embed = { alias: string | null; table: string; disambiguator: string | null };

/** Pull the top-level embedded relations out of a PostgREST select string. */
export function parseEmbeds(select: string): Embed[] {
  const embeds: Embed[] = [];
  const re = /(?:(\w+)\s*:\s*)?(\w+)(!\w+)?\s*\(/g;
  let depth = 0;
  let index = 0;

  // Only consider matches at nesting depth 0 — an inner `categories(name)`
  // inside another embed is that embed's problem, not a top-level one.
  while (index < select.length) {
    re.lastIndex = index;
    const match = re.exec(select);
    if (!match) break;

    // Count parens between where we were and this match to know our depth.
    for (const ch of select.slice(index, match.index)) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }

    if (depth === 0) {
      embeds.push({ alias: match[1] ?? null, table: match[2], disambiguator: match[3] ?? null });
    }

    depth++; // the paren this match just opened
    index = match.index + match[0].length;
  }

  return embeds;
}

function listSourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => /\.(tsx|ts)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .map((entry) => path.join(dir, entry));
}

/** Every literal `.from('x') … .select('…')` pair in the codebase. */
function findLiteralQueries(): { file: string; table: string; select: string }[] {
  const results: { file: string; table: string; select: string }[] = [];
  const re = /\.from\(\s*['"](\w+)['"]\s*\)([\s\S]{0,600}?)\.select\(\s*['"]([^'"]*)['"]/g;

  for (const file of listSourceFiles(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      results.push({
        file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
        table: m[1],
        select: m[3],
      });
    }
  }
  return results;
}

const foreignKeys = parseForeignKeys();
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
    // Sanity guard: if parsing silently breaks, every assertion below would
    // pass vacuously and this file would become decoration.
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

  // The direct regression pin. Before the fix this select embedded a bare
  // `accounts(name)` and the live export returned nothing at all.
  it('the transactions export select disambiguates every ambiguous embed', () => {
    expect(offendingEmbeds('transactions', TRANSACTIONS_EXPORT_SELECT)).toEqual([]);
  });

  // Without this, the assertions above could all be green because the
  // detector never detects anything. This pins the exact string that shipped
  // and failed in production, and proves the guard rejects it.
  it('rejects the bare accounts(name) embed that actually shipped and broke', () => {
    const shipped =
      'date, amount, type, description, is_bridge, recurring_item_id, source, accounts(name), categories(name, name_fr)';

    const problems = offendingEmbeds('transactions', shipped);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('transactions → accounts is ambiguous');
    expect(problems[0]).toContain('account_id, bridge_source_account');
  });

  it('no literal .from().select() in the codebase embeds an ambiguous relation bare', () => {
    const queries = findLiteralQueries();

    // Sanity guard: the scan must actually be finding queries, or this passes
    // vacuously the moment the regex or the call style drifts.
    expect(queries.length).toBeGreaterThan(10);
    expect(queries.some((q) => q.select.includes('('))).toBe(true);

    const failures = queries.flatMap(({ file, table, select }) =>
      offendingEmbeds(table, select).map((reason) => `${file}: .from('${table}') — ${reason}`)
    );
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });
});

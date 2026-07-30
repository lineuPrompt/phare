import fs from 'node:fs';
import path from 'node:path';

/**
 * Shared test infrastructure: reads `supabase/migrations/` as the source of
 * truth for the database shape, and scans `src/` for the PostgREST queries
 * written against it.
 *
 * This exists because a whole class of bug is invisible to unit tests. A
 * `.select()` string is validated by Postgres at runtime, not by TypeScript,
 * so a query naming a column that doesn't exist — or embedding a relation
 * reachable by two foreign keys — compiles, passes every mocked test, and
 * returns nothing in production. That is exactly how the CSV export shipped
 * broken (PGRST201, transactions → accounts via both account_id and
 * bridge_source_account).
 *
 * Not a .test.ts file, so vitest's default include pattern doesn't collect it,
 * and both source scanners skip __tests__ so it never scans itself.
 */

const REPO_ROOT = path.resolve(process.cwd());
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/** Column types that mark a line as a real column definition, not a constraint. */
const COLUMN_TYPE =
  /^(uuid|text|numeric|int|int4|int8|integer|bigint|smallint|boolean|bool|date|timestamptz|timestamp|jsonb|json|serial|bigserial|real|double|char|varchar|time|interval)\b/i;

export type ForeignKey = { table: string; column: string; target: string };
export type Schema = {
  foreignKeys: ForeignKey[];
  /** table → set of column names */
  columns: Map<string, Set<string>>;
};

/**
 * Replay every migration in filename order, tracking which table each
 * statement applies to. Handles inline CREATE TABLE columns, ALTER TABLE ADD
 * COLUMN, and DROP TABLE (the legacy `goals` table is dropped this way).
 *
 * No migration in this repo uses DROP COLUMN or RENAME COLUMN; if one ever
 * does, this parser will silently keep the stale name and the checks built on
 * it will go quiet. That's the known limit of reading DDL as text.
 */
export function parseSchema(): Schema {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  const foreignKeys = new Map<string, ForeignKey>();
  const columns = new Map<string, Set<string>>();

  const addColumn = (table: string, column: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(column);
  };

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    let currentTable: string | null = null;
    let inCreateTable = false;

    for (const raw of sql.split(/\r?\n/)) {
      const line = raw.replace(/--.*$/, '');

      const create = line.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(/i);
      if (create) {
        currentTable = create[1];
        inCreateTable = true;
        continue;
      }

      const drop = line.match(/DROP TABLE(?:\s+IF EXISTS)?\s+(\w+)/i);
      if (drop) {
        columns.delete(drop[1]);
        for (const [key, fk] of foreignKeys) {
          if (fk.table === drop[1]) foreignKeys.delete(key);
        }
        currentTable = null;
        inCreateTable = false;
        continue;
      }

      const alter = line.match(/ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)/i);
      if (alter) {
        currentTable = alter[1];
        inCreateTable = false;
      }

      if (inCreateTable && /^\s*\)\s*;/.test(line)) {
        inCreateTable = false;
        currentTable = null;
        continue;
      }

      if (currentTable) {
        const added = line.match(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)\s+(\w+)/i);
        if (added && COLUMN_TYPE.test(added[2])) {
          addColumn(currentTable, added[1]);
        } else if (inCreateTable) {
          const inline = line.match(/^\s*(\w+)\s+(\w+)/);
          if (inline && COLUMN_TYPE.test(inline[2])) addColumn(currentTable, inline[1]);
        }

        const ref = line.match(
          /(?:ADD COLUMN(?:\s+IF NOT EXISTS)?\s+)?(\w+)\s+uuid\b[^,]*?REFERENCES\s+(\w+)\s*\(/i
        );
        if (ref) {
          // Keyed so a re-run CREATE TABLE IF NOT EXISTS doesn't double-count.
          foreignKeys.set(`${currentTable}.${ref[1]}->${ref[2]}`, {
            table: currentTable,
            column: ref[1],
            target: ref[2],
          });
        }
      }
    }
  }

  return { foreignKeys: [...foreignKeys.values()], columns };
}

/** (childTable → targetTable) pairs reachable by more than one FK column. */
export function buildAmbiguousPairs(foreignKeys: ForeignKey[]): Map<string, string[]> {
  const columnsByPair = new Map<string, Set<string>>();
  for (const fk of foreignKeys) {
    const key = `${fk.table}->${fk.target}`;
    if (!columnsByPair.has(key)) columnsByPair.set(key, new Set());
    columnsByPair.get(key)!.add(fk.column);
  }

  const ambiguous = new Map<string, string[]>();
  for (const [key, cols] of columnsByPair) {
    if (cols.size > 1) ambiguous.set(key, [...cols].sort());
  }
  return ambiguous;
}

/** Split a select string on top-level commas, leaving embeds intact. */
export function topLevelParts(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of select) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current);

  return parts.map((p) => p.trim()).filter(Boolean);
}

export type Embed = { alias: string | null; table: string; disambiguator: string | null };

/** The top-level embedded relations in a select string. */
export function parseEmbeds(select: string): Embed[] {
  return topLevelParts(select)
    .filter((part) => part.includes('('))
    .map((part): Embed | null => {
      const m = part.match(/^(?:(\w+)\s*:\s*)?(\w+)(!\w+)?\s*\(/);
      return m ? { alias: m[1] ?? null, table: m[2], disambiguator: m[3] ?? null } : null;
    })
    .filter((e): e is Embed => e !== null);
}

/** The plain (non-embed) column names in a select string, aliases resolved. */
export function parsePlainColumns(select: string): string[] {
  return topLevelParts(select)
    .filter((part) => !part.includes('(') && part !== '*')
    .map((part) => (part.includes(':') ? part.split(':')[1] : part).trim())
    .filter(Boolean);
}

function listSourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => /\.(tsx|ts)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .map((entry) => path.join(dir, entry));
}

export type LiteralQuery = { file: string; table: string; select: string };

/**
 * Every literal `.from('x') … .select('…')` pair in src/.
 *
 * The gap between the two must not contain another `.from(` or `.rpc(`, or a
 * `.from('budgets').delete()` would wrongly pair with a later select on a
 * different table — which it did, producing a phantom `budgets.name` finding
 * the first time this scan ran.
 */
export function findLiteralQueries(): LiteralQuery[] {
  const results: LiteralQuery[] = [];
  const re =
    /\.from\(\s*['"](\w+)['"]\s*\)(?:(?!\.from\(|\.rpc\()[\s\S]){0,600}?\.select\(\s*['"]([^'"]*)['"]/g;

  for (const file of listSourceFiles(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      results.push({
        file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
        table: m[1],
        select: m[2],
      });
    }
  }
  return results;
}

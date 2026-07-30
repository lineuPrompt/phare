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
 * It also parses ON DELETE rules, because the second class of invisible bug is
 * a cascade nobody enumerated: file_imports.uploaded_by was ON DELETE CASCADE
 * from users, so deleting one member would have destroyed the household's
 * import provenance. Reading delete rules statically turns "discover the blast
 * radius one bug at a time" into one list.
 *
 * PARSING IS STATEMENT-BASED, not line-based. A foreign key can be declared
 * three ways, and the third spans multiple lines:
 *   1. inline in CREATE TABLE      — `col uuid REFERENCES t(id) ON DELETE …`
 *   2. ALTER TABLE ADD COLUMN      — `ADD COLUMN col uuid REFERENCES t(id) …`
 *   3. ALTER TABLE ADD CONSTRAINT  — `FOREIGN KEY (col) REFERENCES t(id) …`
 * Migrations replay in filename order, so a later declaration for the same
 * (table, column, target) overwrites an earlier one — which is how the
 * uploaded_by CASCADE → SET NULL swap is picked up.
 *
 * Not a .test.ts file, so vitest's default include pattern doesn't collect it,
 * and both source scanners skip __tests__ so it never scans itself.
 */

const REPO_ROOT = path.resolve(process.cwd());
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const SRC_DIR = path.join(REPO_ROOT, 'src');

const COLUMN_TYPE =
  /^(uuid|text|numeric|int|int4|int8|integer|bigint|smallint|boolean|bool|date|timestamptz|timestamp|jsonb|json|serial|bigserial|real|double|char|varchar|time|interval)\b/i;

/** Table-level definitions inside CREATE TABLE that are not columns. */
const NOT_A_COLUMN = /^(UNIQUE|CHECK|PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|EXCLUDE|LIKE)\b/i;

export type OnDelete = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

export type ForeignKey = {
  table: string;
  column: string;
  target: string;
  /** Postgres defaults to NO ACTION when the clause is omitted. */
  onDelete: OnDelete;
};

export type Schema = {
  foreignKeys: ForeignKey[];
  /** table → set of column names */
  columns: Map<string, Set<string>>;
};

/**
 * Split SQL into statements, ignoring semicolons inside $$-quoted function
 * bodies and single-quoted literals, and stripping `--` comments.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  let inQuote = false;
  let inComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    if (inComment) {
      if (ch === '\n') { inComment = false; current += ch; }
      continue;
    }
    if (!inDollar && !inQuote && next2 === '--') { inComment = true; i++; continue; }
    if (!inQuote && next2 === '$$') { inDollar = !inDollar; current += next2; i++; continue; }
    if (!inDollar && ch === "'") { inQuote = !inQuote; current += ch; continue; }

    if (ch === ';' && !inDollar && !inQuote) {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current);

  return statements.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Split on top-level commas, leaving parenthesised groups intact. */
export function topLevelParts(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of input) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current);

  return parts.map((p) => p.trim()).filter(Boolean);
}

function readOnDelete(fragment: string): OnDelete {
  const m = fragment.match(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i);
  return (m ? m[1].toUpperCase() : 'NO ACTION') as OnDelete;
}

/** The parenthesised body of `CREATE TABLE x ( … )`. */
function createTableBody(statement: string): string | null {
  const open = statement.indexOf('(');
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    else if (statement[i] === ')') {
      depth--;
      if (depth === 0) return statement.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Replay every migration in filename order.
 *
 * Known limit, unchanged: no migration in this repo uses DROP COLUMN or
 * RENAME COLUMN. If one ever does, this parser keeps the stale name and the
 * checks built on it go quiet. Dropping a CONSTRAINT by a name computed at
 * runtime (the DO block in the uploaded_by migration) is likewise invisible —
 * that migration's subsequent ADD CONSTRAINT is what this reads.
 */
export function parseSchema(): Schema {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  const foreignKeys = new Map<string, ForeignKey>();
  const columns = new Map<string, Set<string>>();

  const addColumn = (table: string, column: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(column);
  };

  const addForeignKey = (fk: ForeignKey) => {
    // Keyed so a re-run CREATE TABLE IF NOT EXISTS doesn't double-count, and
    // so a later ADD CONSTRAINT supersedes the original inline declaration.
    foreignKeys.set(`${fk.table}.${fk.column}->${fk.target}`, fk);
  };

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    for (const statement of splitStatements(sql)) {
      const dropTable = statement.match(/^DROP TABLE(?: IF EXISTS)? (\w+)/i);
      if (dropTable) {
        columns.delete(dropTable[1]);
        for (const [key, fk] of foreignKeys) {
          if (fk.table === dropTable[1]) foreignKeys.delete(key);
        }
        continue;
      }

      const createTable = statement.match(/^CREATE TABLE(?: IF NOT EXISTS)? (\w+)\s*\(/i);
      if (createTable) {
        const table = createTable[1];
        const body = createTableBody(statement);
        if (!body) continue;

        for (const definition of topLevelParts(body)) {
          const tableLevelFk = definition.match(
            /^FOREIGN KEY \(\s*(\w+)\s*\)\s* REFERENCES ((?:\w+\.)?\w+)\s*\(/i
          );
          if (tableLevelFk) {
            addForeignKey({
              table,
              column: tableLevelFk[1],
              target: tableLevelFk[2],
              onDelete: readOnDelete(definition),
            });
            continue;
          }

          if (NOT_A_COLUMN.test(definition)) continue;

          const column = definition.match(/^(\w+)\s+(\w+)/);
          if (!column || !COLUMN_TYPE.test(column[2])) continue;
          addColumn(table, column[1]);

          const ref = definition.match(/REFERENCES ((?:\w+\.)?\w+)\s*\(/i);
          if (ref) {
            addForeignKey({ table, column: column[1], target: ref[1], onDelete: readOnDelete(definition) });
          }
        }
        continue;
      }

      const alter = statement.match(/^ALTER TABLE(?: IF EXISTS)? (\w+) (.*)$/i);
      if (!alter) continue;
      const table = alter[1];
      const rest = alter[2];

      const addConstraint = rest.match(
        /ADD CONSTRAINT \w+ FOREIGN KEY \(\s*(\w+)\s*\) REFERENCES ((?:\w+\.)?\w+)\s*\(/i
      );
      if (addConstraint) {
        addForeignKey({
          table,
          column: addConstraint[1],
          target: addConstraint[2],
          onDelete: readOnDelete(rest),
        });
        continue;
      }

      const addColumnStatement = rest.match(/ADD COLUMN(?: IF NOT EXISTS)? (\w+) (\w+)/i);
      if (addColumnStatement && COLUMN_TYPE.test(addColumnStatement[2])) {
        addColumn(table, addColumnStatement[1]);

        const ref = rest.match(/REFERENCES ((?:\w+\.)?\w+)\s*\(/i);
        if (ref) {
          addForeignKey({
            table,
            column: addColumnStatement[1],
            target: ref[1],
            onDelete: readOnDelete(rest),
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

/** Look up one FK's delete rule. Returns null when the FK doesn't exist. */
export function deleteRuleFor(
  foreignKeys: ForeignKey[],
  table: string,
  column: string
): OnDelete | null {
  return foreignKeys.find((fk) => fk.table === table && fk.column === column)?.onDelete ?? null;
}

/**
 * Every FK pointing (directly or transitively) at one of the given root
 * tables, breadth-first, so a deletion's blast radius can be read as one list
 * instead of discovered one bug at a time.
 *
 * A CASCADE edge continues the walk — deleting the parent deletes the child,
 * so the child's own children are in radius too. SET NULL / RESTRICT /
 * NO ACTION edges terminate: the child row survives, so nothing below it is
 * reached by this deletion.
 */
export function cascadePathsFrom(
  foreignKeys: ForeignKey[],
  roots: string[]
): { fk: ForeignKey; depth: number; via: string }[] {
  const results: { fk: ForeignKey; depth: number; via: string }[] = [];
  const seen = new Set<string>();
  let frontier = roots.map((table) => ({ table, depth: 0, via: table }));

  while (frontier.length > 0) {
    const next: typeof frontier = [];

    for (const node of frontier) {
      for (const fk of foreignKeys) {
        if (fk.target !== node.table) continue;

        const key = `${fk.table}.${fk.column}->${fk.target}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const via = `${node.via} → ${fk.table}.${fk.column}`;
        results.push({ fk, depth: node.depth + 1, via });

        if (fk.onDelete === 'CASCADE') {
          next.push({ table: fk.table, depth: node.depth + 1, via });
        }
      }
    }
    frontier = next;
  }

  return results;
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

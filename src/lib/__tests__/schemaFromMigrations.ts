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

// ---------------------------------------------------------------------------
// ROW LEVEL SECURITY POLICIES
//
// Parsed so a test can ask the question that has now cost this project five
// bugs: does this read return what the code assumes it returns? RLS silently
// TRUNCATES a result — no error, just fewer rows — so a query written against
// a policy it does not satisfy looks like working code and passes any mock
// whose fixture was shaped by the author's expectation.
// ---------------------------------------------------------------------------

export type PolicyShape =
  /** `id = auth.uid()` — the caller's OWN row and nothing else. */
  | { kind: 'own_user_row'; column: string }
  /** `id = auth_household_id()` — the caller's own household row. */
  | { kind: 'own_household_row'; column: string }
  /** `household_id = auth_household_id()`, or its inlined SELECT equivalent. */
  | { kind: 'household_scoped'; column: string }
  /** Anything this classifier does not recognise — never treated as safe. */
  | { kind: 'unclassified' };

export type RlsPolicy = {
  name: string;
  table: string;
  command: string;
  usingExpr: string;
  shape: PolicyShape;
};

/**
 * Strip wrapping parentheses, but ONLY when the opening paren's match is the
 * final character. A naive `replace(/\)$/)` eats the closer of `auth.uid()`
 * and turns a recognisable policy into an unclassified one — which is exactly
 * the kind of quiet mis-parse that makes a detector stop detecting.
 */
function stripWrappingParens(input: string): string {
  let s = input.trim();

  while (s.startsWith('(')) {
    let depth = 0;
    let matchedAtEnd = false;

    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) {
          matchedAtEnd = i === s.length - 1;
          break;
        }
      }
    }
    if (!matchedAtEnd) break;
    s = s.slice(1, -1).trim();
  }

  return s;
}

export function classifyPolicy(expr: string): PolicyShape {
  const normalized = stripWrappingParens(expr.replace(/\s+/g, ' ').trim());

  if (/^id\s*=\s*auth\.uid\(\)$/i.test(normalized)) return { kind: 'own_user_row', column: 'id' };
  if (/^id\s*=\s*auth_household_id\(\)$/i.test(normalized)) return { kind: 'own_household_row', column: 'id' };
  if (/^household_id\s*=\s*auth_household_id\(\)$/i.test(normalized)) {
    return { kind: 'household_scoped', column: 'household_id' };
  }
  // The inlined form the later migrations use — semantically identical.
  if (/^household_id\s*=\s*\(\s*SELECT household_id FROM (?:public\.)?users WHERE id = auth\.uid\(\)\s*\)$/i.test(normalized)) {
    return { kind: 'household_scoped', column: 'household_id' };
  }
  return { kind: 'unclassified' };
}

export function parsePolicies(): RlsPolicy[] {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const policies = new Map<string, RlsPolicy>();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    for (const statement of splitStatements(sql)) {
      const m = statement.match(
        /^CREATE POLICY "?([\w ]+)"? ON (\w+)(?: AS \w+)?(?: FOR (ALL|SELECT|INSERT|UPDATE|DELETE))?(?: TO [\w, ]+)? USING (.+?)(?: WITH CHECK .*)?$/i
      );
      if (!m) continue;

      const [, name, table, command, usingExpr] = m;
      // A later migration may redefine a policy; last definition wins.
      policies.set(`${table}.${name}`, {
        name,
        table,
        command: (command ?? 'ALL').toUpperCase(),
        // Stored stripped so failure messages read `(id = auth.uid())` rather
        // than `((id = auth.uid()))`.
        usingExpr: stripWrappingParens(usingExpr.replace(/\s+/g, ' ').trim()),
        shape: classifyPolicy(usingExpr),
      });
    }
  }

  return [...policies.values()];
}

/** The read-relevant policy for a table, if one exists. */
export function readPolicyFor(policies: RlsPolicy[], table: string): RlsPolicy | null {
  return policies.find((p) => p.table === table && (p.command === 'ALL' || p.command === 'SELECT')) ?? null;
}

export type ClientRead = {
  file: string;
  /** The identifier the query was built on — `supabase` vs `admin`. */
  clientVar: string;
  table: string;
  select: string;
  /** Columns passed to .eq(...) on this query. */
  filterColumns: string[];
  /** Set when this read is an embedded relation rather than the .from() table. */
  embeddedFrom?: string;
};

/**
 * Whether a client identifier denotes the SERVICE-ROLE client.
 *
 * THIS IS THE HEURISTIC in the whole check, and it is naming-convention based:
 * every service-role client in this codebase is assigned to `admin` (from
 * createAdminClient()), every RLS-scoped one to `supabase`. It is reliable
 * here only because that convention is uniform.
 *
 * It fails in the SAFE direction: a service-role client under some other name
 * would be treated as a session client and produce a false positive — a noisy
 * test, not a missed bug. The reverse (a session client named `admin…`) would
 * be a false negative, which is why the name is checked rather than inferred.
 */
export function isServiceRoleClient(clientVar: string): boolean {
  return /^admin/i.test(clientVar);
}

/**
 * Every literal `<client>.from('x') … .select('…')` read in src/, with the
 * client identifier and the .eq() filter columns that follow it.
 */
export function findClientReads(): ClientRead[] {
  const reads: ClientRead[] = [];
  const re =
    /(\w+)\s*\.from\(\s*['"](\w+)['"]\s*\)(?:(?!\.from\(|\.rpc\()[\s\S]){0,600}?\.select\(\s*['"]([^'"]*)['"][\s\S]{0,400}/g;

  for (const file of listSourceFiles(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');

    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const [full, clientVar, table, select] = m;

      // Filters belong to this statement only — stop at the first `;`.
      const tail = full.slice(full.indexOf(select) + select.length);
      const filterColumns = [...tail.split(';')[0].matchAll(/\.eq\(\s*['"](\w+)['"]/g)].map((f) => f[1]);

      reads.push({ file: rel, clientVar, table, select, filterColumns });

      // An embedded relation is a read of THAT table too, and carries no
      // filters of its own — exactly how the users(email, role) embed slipped
      // past RLS unnoticed for as long as it did.
      for (const embed of parseEmbeds(select)) {
        reads.push({ file: rel, clientVar, table: embed.table, select, filterColumns: [], embeddedFrom: table });
      }
    }
  }

  return reads;
}

/**
 * Reads that RLS will truncate relative to what the code appears to expect.
 *
 * Only `own_user_row` policies (`id = auth.uid()`) are checked. That shape
 * resolves to exactly ONE row — the caller's — so any session-client read of
 * such a table not filtered by that column is asking for rows the database
 * will never return.
 *
 * `household_scoped` and `own_household_row` are deliberately NOT flagged:
 * they resolve to the caller's own household, which is precisely the scope
 * application code reads at, so an unfiltered read there returns exactly what
 * the code wants. Flagging those would be noise, and noise is how a detector
 * gets muted.
 */
export function findRlsTruncatedReads(
  reads: ClientRead[],
  policies: RlsPolicy[]
): { read: ClientRead; reason: string }[] {
  const findings: { read: ClientRead; reason: string }[] = [];

  for (const read of reads) {
    if (isServiceRoleClient(read.clientVar)) continue;

    const policy = readPolicyFor(policies, read.table);
    if (!policy || policy.shape.kind !== 'own_user_row') continue;

    const { column } = policy.shape;
    if (read.filterColumns.includes(column)) continue;

    findings.push({
      read,
      reason: read.embeddedFrom
        ? `${read.file}: embeds ${read.table}(...) from ${read.embeddedFrom} on session client '${read.clientVar}' — policy "${policy.name}" is (${policy.usingExpr}), so this resolves to the caller's own row ONLY and is null for everyone else. Read it with the service-role client instead.`
        : `${read.file}: .from('${read.table}') on session client '${read.clientVar}' filtered by [${read.filterColumns.join(', ') || 'nothing'}] — policy "${policy.name}" is (${policy.usingExpr}), so a read not filtered by '${column}' returns the caller's own row ONLY. Read it with the service-role client instead.`,
    });
  }

  return findings;
}

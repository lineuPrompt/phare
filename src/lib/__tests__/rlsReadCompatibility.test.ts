import { describe, it, expect } from 'vitest';
import {
  parsePolicies,
  classifyPolicy,
  readPolicyFor,
  findClientReads,
  findRlsTruncatedReads,
  isServiceRoleClient,
  type ClientRead,
} from './schemaFromMigrations';

/**
 * Catches reads that Row Level Security will silently TRUNCATE.
 *
 * THE FAILURE MODE
 * ----------------
 * RLS does not error on an over-broad read. It returns fewer rows. So a query
 * asking for data the policy forbids looks like working code, type-checks, and
 * passes any mock — because the mock's fixture was written to match what the
 * author expected, not what the database actually returns.
 *
 * That cost two bugs in one route:
 *   1. `.from('household_members').select('… users(email, role)')` on the
 *      session client. Policy `users_all` is `id = auth.uid()`, so the embed
 *      was null for every member except the caller. A `?? 'member'` default on
 *      the client turned "cannot read" into "is a member": a household with
 *      two owners rendered as one owner and one member, and "Make owner"
 *      appeared for someone who already was one.
 *   2. `.from('users').select('household_id').eq('email', …)` on the session
 *      client, looking up somebody ELSE's row by email. Always null, so the
 *      resend branch behind it was unreachable and re-inviting an existing
 *      member returned "they belong to a different household".
 *
 * Both were invisible to unit tests. Both are decidable statically, from the
 * policy in supabase/migrations/ and the query in src/ — which is what this
 * does, same source-of-truth discipline as the embed-ambiguity and
 * column-existence detectors.
 *
 * WHAT THIS CANNOT CATCH — read before trusting a green run
 * ---------------------------------------------------------
 *   - Non-literal queries. Only `client.from('x').select('literal')` is
 *     scanned; a select built from a variable or helper is invisible.
 *   - Client identity is a NAMING HEURISTIC (`admin*` = service role). A
 *     service-role client named anything else produces a false positive; a
 *     session client named `admin…` would be a false negative.
 *   - Only `id = auth.uid()` policies are checked. Household-scoped policies
 *     are not, by design — see findRlsTruncatedReads.
 *   - WRITES are not checked at all. RLS truncates UPDATE and DELETE the same
 *     silent way, and nothing here looks at them.
 *   - Whether the filter VALUE is correct. `.eq('id', someOtherUserId)`
 *     satisfies this check and still returns nothing.
 *   - Policies whose USING expression this classifier does not recognise fall
 *     through as 'unclassified' and are skipped rather than guessed at.
 *
 * AND THE STANDING RULE: a static check shortens the loop, it does not close
 * it. Every one of the five bugs in this class was found by running the real
 * query against the real database, not by reading code. This makes the next
 * one cheaper to find; it does not replace the live probe.
 */

const policies = parsePolicies();
const reads = findClientReads();

describe('RLS policy parsing', () => {
  it('parses the policies out of the migrations at all', () => {
    // Vacuity guard: a parser that finds nothing makes everything below pass.
    expect(policies.length).toBeGreaterThan(10);
    expect(policies.some((p) => p.table === 'users')).toBe(true);
  });

  it('classifies the three shapes actually used in this schema', () => {
    expect(classifyPolicy('id = auth.uid()')).toEqual({ kind: 'own_user_row', column: 'id' });
    expect(classifyPolicy('id = auth_household_id()')).toEqual({ kind: 'own_household_row', column: 'id' });
    expect(classifyPolicy('household_id = auth_household_id()')).toEqual({
      kind: 'household_scoped',
      column: 'household_id',
    });
    // The inlined equivalent used by the later migrations.
    expect(
      classifyPolicy('household_id = (SELECT household_id FROM public.users WHERE id = auth.uid())')
    ).toEqual({ kind: 'household_scoped', column: 'household_id' });
  });

  it('refuses to classify an expression it does not recognise', () => {
    // Guessing here would be worse than skipping — an unrecognised policy
    // must never be silently treated as safe.
    expect(classifyPolicy('true')).toEqual({ kind: 'unclassified' });
    expect(classifyPolicy('owner_id = auth.uid() OR is_public')).toEqual({ kind: 'unclassified' });
  });

  it('knows users is the own-row table that caused both bugs', () => {
    const usersPolicy = readPolicyFor(policies, 'users');
    expect(usersPolicy?.shape).toEqual({ kind: 'own_user_row', column: 'id' });
  });

  it('does not misclassify household-scoped tables as own-row', () => {
    for (const table of ['transactions', 'household_members', 'accounts', 'events']) {
      expect(readPolicyFor(policies, table)?.shape.kind, table).toBe('household_scoped');
    }
  });
});

describe('client read extraction', () => {
  it('finds session-client reads to check', () => {
    // Vacuity guard, per the brief: a check with nothing to check must fail,
    // not pass. If the scan silently stops matching — a refactor to a query
    // builder, a rename — this goes red instead of quietly green.
    const sessionReads = reads.filter((r) => !isServiceRoleClient(r.clientVar));
    expect(sessionReads.length).toBeGreaterThan(20);
  });

  it('distinguishes the service-role client from the session client', () => {
    expect(isServiceRoleClient('admin')).toBe(true);
    expect(isServiceRoleClient('adminClient')).toBe(true);
    expect(isServiceRoleClient('supabase')).toBe(false);
  });

  it('captures eq() filter columns and treats an embed as a read of that table', () => {
    const embedded = reads.filter((r) => r.embeddedFrom);
    expect(embedded.length).toBeGreaterThan(0);
    expect(embedded.every((r) => r.filterColumns.length === 0)).toBe(true);

    // Some real read filters by id — proves filter capture works at all.
    expect(reads.some((r) => r.table === 'users' && r.filterColumns.includes('id'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEETH. Without these the detector could be green because it detects nothing.
// Both fixtures are the PRE-FIX form of real code from the members route.
// ---------------------------------------------------------------------------
describe('the detector flags the two reads that actually shipped broken', () => {
  const embedBug: ClientRead = {
    file: 'src/app/api/household/members/route.ts',
    clientVar: 'supabase',
    table: 'users',
    select: 'id, name, user_id, users(email, role)',
    filterColumns: [],
    embeddedFrom: 'household_members',
  };

  const byEmailBug: ClientRead = {
    file: 'src/app/api/household/members/route.ts',
    clientVar: 'supabase',
    table: 'users',
    select: 'household_id',
    filterColumns: ['email'],
  };

  it('flags the users(email, role) embed on the session client', () => {
    const found = findRlsTruncatedReads([embedBug], policies);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toContain('embeds users(...)');
    expect(found[0].reason).toContain('id = auth.uid()');
  });

  it('flags the by-email lookup on the session client', () => {
    const found = findRlsTruncatedReads([byEmailBug], policies);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toContain("filtered by [email]");
  });

  it('does NOT flag either once moved to the service-role client — the actual fix', () => {
    const fixed = [
      { ...embedBug, clientVar: 'admin' },
      { ...byEmailBug, clientVar: 'admin' },
    ];
    expect(findRlsTruncatedReads(fixed, policies)).toEqual([]);
  });

  it('does NOT flag a correctly filtered own-row read', () => {
    const good: ClientRead = {
      file: 'x.ts',
      clientVar: 'supabase',
      table: 'users',
      select: 'household_id, role',
      filterColumns: ['id'],
    };
    expect(findRlsTruncatedReads([good], policies)).toEqual([]);
  });

  it('does NOT flag household-scoped reads, filtered or not', () => {
    const householdReads: ClientRead[] = [
      { file: 'x.ts', clientVar: 'supabase', table: 'transactions', select: 'id', filterColumns: [] },
      { file: 'x.ts', clientVar: 'supabase', table: 'accounts', select: 'id', filterColumns: ['household_id'] },
    ];
    expect(findRlsTruncatedReads(householdReads, policies)).toEqual([]);
  });
});

describe('the codebase as it stands', () => {
  it('has no session-client read that RLS will truncate', () => {
    const findings = findRlsTruncatedReads(reads, policies);
    expect(findings.map((f) => f.reason), `\n${findings.map((f) => f.reason).join('\n\n')}`).toEqual([]);
  });
});

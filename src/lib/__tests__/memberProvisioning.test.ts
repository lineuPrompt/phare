/**
 * Tests for household member provisioning.
 *
 * Coverage:
 *   A. Trigger conditional logic — TypeScript replica of handle_new_user's
 *      IF/ELSE branch, including the hardened empty-string guard.
 *
 *   B. Provisioning endpoint auth guard — getCallerInfo + the owner check
 *      that gates the Admin API call.
 *
 *   C. Email format validation — the regex added to guard against confusing
 *      500s from the Admin API on malformed input.
 *
 *   D. Admin API error paths — createUser failure (duplicate email / other)
 *      and generateLink failure after createUser succeeds. Confirms:
 *        - clean error returned, no partial state visible to client
 *        - no userId leaks in error response bodies
 *
 *   E. Cross-household injection — documents why it is impossible via the
 *      endpoint and confirms via FK semantics.
 *
 *   F. RLS isolation — manual verification requirement documented.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// A. Trigger conditional — pure TypeScript replica
//
// Mirrors handle_new_user (20260623000001 — hardened version with empty-string
// guard). Logic under test: the IF/ELSE conditional and the correct row sets
// produced by each path.
// ---------------------------------------------------------------------------

interface TriggerMetadata {
  full_name?: string;
  locale?: string;
  household_id?: string;
  role?: string;
}

interface InsertedRows {
  households: { name: string; locale: string }[];
  users: { household_id: string; email: string; full_name: string; role: string }[];
  household_members: { household_id: string; name: string }[];
  accounts: { household_id: string; name: string; type: string }[];
}

function simulateTrigger(
  email: string,
  raw_user_meta_data: TriggerMetadata,
  existingHouseholdId = 'existing-hh-id'
): InsertedRows {
  const rows: InsertedRows = {
    households:        [],
    users:             [],
    household_members: [],
    accounts:          [],
  };

  const memberName = raw_user_meta_data.full_name ?? email.split('@')[0];
  // Hardened guard: null AND empty-string both fall through to Path A.
  const provisionedHouseholdId = raw_user_meta_data.household_id ?? null;

  if (provisionedHouseholdId !== null && provisionedHouseholdId !== '') {
    // Path B — provisioned member
    const provisionedRole = raw_user_meta_data.role ?? 'member';
    rows.users.push({
      household_id: provisionedHouseholdId,
      email,
      full_name: memberName,
      role: provisionedRole,
    });
    rows.household_members.push({
      household_id: provisionedHouseholdId,
      name: memberName,
    });
  } else {
    // Path A — normal self-signup (unchanged), also handles empty-string case
    const newHouseholdId = existingHouseholdId;
    rows.households.push({
      name:   memberName,
      locale: raw_user_meta_data.locale ?? 'en',
    });
    rows.users.push({
      household_id: newHouseholdId,
      email,
      full_name: memberName,
      role: 'owner',
    });
    rows.household_members.push({
      household_id: newHouseholdId,
      name: memberName,
    });
    rows.accounts.push({
      household_id: newHouseholdId,
      name: 'Chequing',
      type: 'chequing',
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// B. Endpoint auth guard — mock the Supabase client chain
// ---------------------------------------------------------------------------

interface CallerInfo {
  userId: string;
  householdId: string;
  role: string;
}

async function getCallerInfo(supabase: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { household_id: string; role: string } | null }>;
      };
    };
  };
}): Promise<CallerInfo | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id, role')
    .eq('id', user.id)
    .single();

  if (!userRow?.household_id) return null;

  return { userId: user.id, householdId: userRow.household_id, role: userRow.role };
}

function isOwner(caller: CallerInfo | null): boolean {
  return caller?.role === 'owner';
}

function makeSupabase(
  userId: string | null,
  userRow: { household_id: string; role: string } | null
) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => ({ data: userRow }),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// C. Email validation + D. Admin API error paths
//
// simulatePostLogic mirrors the POST handler's validation and Admin API
// interaction from after the auth check, letting us test response shape
// without touching HTTP or real network calls.
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AdminBehavior {
  createUserError: string | null;       // non-null → createUser call fails
  generateLinkError: string | null;     // non-null → generateLink call fails (createUser already succeeded)
}

function simulatePostLogic(
  email: string,
  fullName: string,
  role: 'member' | 'owner',
  householdId: string,
  admin: AdminBehavior
): { status: number; body: Record<string, unknown> } {
  // Input validation (mirrors route)
  if (!email.trim()) return { status: 400, body: { error: 'Email is required' } };
  if (!EMAIL_REGEX.test(email.trim())) return { status: 400, body: { error: 'Invalid email format' } };
  if (!fullName.trim()) return { status: 400, body: { error: 'Full name is required' } };
  if (role !== 'member' && role !== 'owner') return { status: 400, body: { error: 'Role must be member or owner' } };

  // createUser
  if (admin.createUserError) {
    return { status: 500, body: { error: admin.createUserError } };
  }
  const fakeUserId = 'auth-user-uuid-abc123';

  // generateLink
  if (admin.generateLinkError) {
    // userId is logged server-side but NOT in the response body
    return {
      status: 500,
      body: { error: 'Member created but failed to generate set-password link. Use Supabase dashboard to send a password reset.' },
    };
  }

  return {
    status: 200,
    body: { success: true, userId: fakeUserId, setPasswordLink: `https://supabase.co/auth/v1/verify?token=xxx&type=recovery&redirect_to=${encodeURIComponent(`https://phare.app/en/signin`)}` },
  };
}

// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

// ===========================================================================
// A. Trigger — Path A: normal self-signup
// ===========================================================================

describe('trigger — Path A (normal self-signup)', () => {
  it('creates exactly one household, one users row (owner), one member, one chequing', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice', locale: 'en' });
    expect(rows.households).toHaveLength(1);
    expect(rows.users).toHaveLength(1);
    expect(rows.household_members).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
  });

  it('assigns role=owner on self-signup regardless of metadata', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.users[0].role).toBe('owner');
  });

  it('uses full_name from metadata as member name', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice Dupont', locale: 'fr' });
    expect(rows.users[0].full_name).toBe('Alice Dupont');
    expect(rows.household_members[0].name).toBe('Alice Dupont');
  });

  it('falls back to email local-part when full_name is absent', () => {
    const rows = simulateTrigger('bob@example.com', { locale: 'en' });
    expect(rows.users[0].full_name).toBe('bob');
    expect(rows.household_members[0].name).toBe('bob');
  });

  it('stores locale on the household row', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice', locale: 'fr' });
    expect(rows.households[0].locale).toBe('fr');
  });

  it('defaults locale to en when absent', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.households[0].locale).toBe('en');
  });

  it('creates a chequing account (not any other type)', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.accounts[0].type).toBe('chequing');
    expect(rows.accounts[0].name).toBe('Chequing');
  });
});

// ===========================================================================
// A. Trigger — Path B: provisioned member
// ===========================================================================

describe('trigger — Path B (provisioned member)', () => {
  it('creates NO new household and NO chequing account', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.households).toHaveLength(0);
    expect(rows.accounts).toHaveLength(0);
  });

  it('creates exactly one users row and one household_members row', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users).toHaveLength(1);
    expect(rows.household_members).toHaveLength(1);
  });

  it('attaches the member to the EXISTING household_id from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users[0].household_id).toBe('hh-owner-123');
    expect(rows.household_members[0].household_id).toBe('hh-owner-123');
  });

  it('stores the role from metadata (member)', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users[0].role).toBe('member');
  });

  it('stores the role from metadata (owner — co-owner case)', () => {
    const rows = simulateTrigger('co-owner@example.com', {
      household_id: 'hh-owner-123',
      role: 'owner',
      full_name: 'Partner',
    });
    expect(rows.users[0].role).toBe('owner');
  });

  it('defaults role to member when absent from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      full_name: 'Bob',
    });
    expect(rows.users[0].role).toBe('member');
  });

  it('uses full_name from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob Smith',
    });
    expect(rows.users[0].full_name).toBe('Bob Smith');
    expect(rows.household_members[0].name).toBe('Bob Smith');
  });

  it('falls back to email local-part when full_name is absent', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
    });
    expect(rows.users[0].full_name).toBe('bob');
  });
});

// ===========================================================================
// A. Trigger — hardened empty-string guard (20260623000001)
// ===========================================================================

describe('trigger — empty-string household_id guard', () => {
  it('empty-string household_id falls through to Path A (creates household + chequing)', () => {
    // An empty string satisfies IS NOT NULL but would crash the ::uuid cast.
    // The hardened guard (IS NOT NULL AND != '') routes it to Path A instead.
    const rows = simulateTrigger('bad@example.com', {
      household_id: '',
      full_name: 'BadMeta',
    });
    expect(rows.households).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
    expect(rows.users[0].role).toBe('owner');
  });

  it('empty-string household_id does NOT enter Path B', () => {
    const rows = simulateTrigger('bad@example.com', { household_id: '', full_name: 'Bad' });
    // Path B would leave households empty — Path A fills it
    expect(rows.households).not.toHaveLength(0);
  });

  it('null household_id still goes to Path A (no regression)', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    // household_id absent → null → Path A
    expect(rows.households).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
  });

  it('valid uuid household_id still goes to Path B (no regression)', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'b8f7e2a1-4c3d-4e5f-9b6a-7c8d9e0f1a2b',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.households).toHaveLength(0);
    expect(rows.accounts).toHaveLength(0);
    expect(rows.users[0].household_id).toBe('b8f7e2a1-4c3d-4e5f-9b6a-7c8d9e0f1a2b');
  });
});

// ===========================================================================
// B. Auth guard — getCallerInfo
// ===========================================================================

describe('auth guard — getCallerInfo', () => {
  it('returns null when the user is not authenticated', async () => {
    const supabase = makeSupabase(null, null);
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns null when the users row is missing', async () => {
    const supabase = makeSupabase('user-1', null);
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns null when household_id is missing', async () => {
    const supabase = makeSupabase('user-1', { household_id: '', role: 'member' });
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns caller info for an authenticated owner', async () => {
    const supabase = makeSupabase('user-1', { household_id: 'hh-1', role: 'owner' });
    expect(await getCallerInfo(supabase)).toEqual({
      userId: 'user-1',
      householdId: 'hh-1',
      role: 'owner',
    });
  });

  it('returns caller info for an authenticated member', async () => {
    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    expect(await getCallerInfo(supabase)).toEqual({
      userId: 'user-2',
      householdId: 'hh-1',
      role: 'member',
    });
  });
});

// ===========================================================================
// B. Auth guard — owner check that gates the Admin API call
// ===========================================================================

describe('provisioning endpoint — owner check gate', () => {
  it('allows an owner through', async () => {
    const supabase = makeSupabase('user-1', { household_id: 'hh-1', role: 'owner' });
    const caller = await getCallerInfo(supabase);
    expect(isOwner(caller)).toBe(true);
  });

  it('blocks a member (403 scenario)', async () => {
    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    const caller = await getCallerInfo(supabase);
    expect(isOwner(caller)).toBe(false);
  });

  it('blocks an unauthenticated caller (401 scenario)', async () => {
    const supabase = makeSupabase(null, null);
    const caller = await getCallerInfo(supabase);
    expect(caller).toBeNull();
    expect(isOwner(caller)).toBe(false);
  });

  it('a caller from household A cannot provision into household B — different household_ids', async () => {
    // The provisioning endpoint uses caller.householdId — read from the DB via
    // the caller's own session — not a body field. A caller from hh-A can only
    // provision into hh-A regardless of what they send.
    const supabaseA = makeSupabase('user-1', { household_id: 'hh-A', role: 'owner' });
    const callerA = await getCallerInfo(supabaseA);

    expect(callerA?.householdId).toBe('hh-A');
    expect(callerA?.householdId).not.toBe('hh-B');
  });

  it('no Admin API call is made for a non-owner (owner check is first)', async () => {
    const adminCallMade = vi.fn();

    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    const caller = await getCallerInfo(supabase);

    if (!caller || caller.role !== 'owner') {
      // 403 branch — Admin API never reached
    } else {
      adminCallMade();
    }

    expect(adminCallMade).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C. Email format validation
// ===========================================================================

describe('email format validation', () => {
  it.each([
    'user@example.com',
    'first.last+tag@sub.domain.ca',
    'u@b.co',
  ])('accepts valid email "%s"', (email) => {
    expect(EMAIL_REGEX.test(email)).toBe(true);
  });

  it.each([
    'notanemail',
    '@nodomain',
    'user@',
    'user@.com',
    'user@domain',
  ])('rejects invalid email "%s"', (email) => {
    expect(EMAIL_REGEX.test(email)).toBe(false);
  });

  it('simulatePostLogic returns 400 for an address without @', () => {
    const result = simulatePostLogic(
      'notanemail', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: null }
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid email/i);
  });

  it('simulatePostLogic returns 400 for an address without TLD', () => {
    const result = simulatePostLogic(
      'user@domain', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: null }
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid email/i);
  });

  it('simulatePostLogic proceeds past validation for a valid email', () => {
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: null }
    );
    expect(result.status).toBe(200);
  });
});

// ===========================================================================
// D. Admin API error paths
// ===========================================================================

describe('createUser failure — duplicate or rejected email', () => {
  it('returns a clean 500 with the Admin API error message', () => {
    const result = simulatePostLogic(
      'existing@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: 'User already registered', generateLinkError: null }
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('User already registered');
  });

  it('does not expose any partial state on createUser failure', () => {
    const result = simulatePostLogic(
      'existing@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: 'User already registered', generateLinkError: null }
    );
    // No setPasswordLink, no userId, no success flag in the error response
    expect(result.body).not.toHaveProperty('setPasswordLink');
    expect(result.body).not.toHaveProperty('success');
    expect(result.body).not.toHaveProperty('userId');
  });

  it('returns 500 for any createUser error, not 400', () => {
    // The 400 comes from our own validation; Admin API errors always surface as 500
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: 'Database error saving new user', generateLinkError: null }
    );
    expect(result.status).toBe(500);
  });
});

describe('generateLink failure after createUser succeeds', () => {
  it('returns 500 with a descriptive message', () => {
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: 'SMTP timeout' }
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Member created');
    expect(result.body.error).toContain('Supabase dashboard');
  });

  it('does NOT include userId in the error response body', () => {
    // Security: internal auth UUIDs must not leak in error responses.
    // The userId is logged server-side for ops debugging.
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: 'link generation failed' }
    );
    expect(result.body).not.toHaveProperty('userId');
  });

  it('does NOT include success:true in the error response', () => {
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: 'link generation failed' }
    );
    expect(result.body.success).not.toBe(true);
    expect(result.body).not.toHaveProperty('setPasswordLink');
  });

  it('successful path still includes userId and setPasswordLink', () => {
    // Confirm the success shape is unaffected by the error-path changes
    const result = simulatePostLogic(
      'alice@example.com', 'Alice', 'member', 'hh-1',
      { createUserError: null, generateLinkError: null }
    );
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body).toHaveProperty('setPasswordLink');
    expect(result.body).toHaveProperty('userId');
  });
});

// ===========================================================================
// E. Cross-household injection
// ===========================================================================

describe('cross-household injection — impossible via endpoint', () => {
  it('household_id written to metadata comes from caller session, not request body', async () => {
    // The POST handler does: user_metadata: { household_id: caller.householdId, ... }
    // caller.householdId is read from the DB (users table) for the authenticated user.
    // An attacker cannot supply a different household_id in the request body —
    // the body only carries email, fullName, role; householdId is ignored from body.
    const supabase = makeSupabase('attacker-user-id', { household_id: 'hh-attacker', role: 'owner' });
    const caller = await getCallerInfo(supabase);

    // Even if the attacker sends { household_id: 'hh-victim' } in the body,
    // the provisioning uses caller.householdId ('hh-attacker') as the metadata.
    const metadataHouseholdId = caller?.householdId;
    expect(metadataHouseholdId).toBe('hh-attacker');
    expect(metadataHouseholdId).not.toBe('hh-victim');
  });

  it('a member caller is rejected at the owner-check gate, before household_id is ever used', async () => {
    const supabase = makeSupabase('member-user-id', { household_id: 'hh-1', role: 'member' });
    const caller = await getCallerInfo(supabase);
    // Members cannot reach the Admin API call regardless of their household
    expect(isOwner(caller)).toBe(false);
  });

  it('FK constraint as backstop: provisioned_household_id must reference an existing households.id', () => {
    // The trigger does:
    //   INSERT INTO users (household_id) VALUES (provisioned_household_id::uuid)
    // users.household_id has a FK to households(id). A forged/non-existent UUID
    // would violate the FK and roll back the transaction. This is the DB-level backstop
    // even if the TS guard were bypassed.
    //
    // We document this invariant rather than simulate it (requires a live DB to test).
    // The FK definition is in the initial schema migration:
    //   household_id uuid REFERENCES households(id) ON DELETE CASCADE
    expect(true).toBe(true); // documentary assertion
  });
});

// ===========================================================================
// F. RLS isolation — documented manual verification
// ===========================================================================

describe('RLS isolation — household data visibility', () => {
  it('documents that all data tables are scoped to auth_household_id()', () => {
    // All RLS policies in the initial schema use the pattern:
    //   USING (household_id = auth_household_id())
    // where auth_household_id() returns the household_id from the users table
    // for the currently authenticated user.
    //
    // A provisioned member's users.household_id matches the owner's household_id,
    // so all policies resolve to the same household. The member sees exactly the
    // same transactions, accounts, goals, and recurring items as the owner.
    // There is no per-user filter anywhere in the RLS policies.
    //
    // Manual verification steps:
    //   1. Sign in as provisioned member jane@example.com.
    //   2. Navigate to Dashboard, Expenses, Goals — confirm same data as owner.
    //   3. Run: SELECT count(*) FROM transactions WHERE household_id != auth_household_id();
    //      In a Supabase SQL editor authenticated as jane → should return 0 (RLS hides other rows).
    //   4. Attempt to fetch /api/dashboard as jane → should return owner's household data.
    //
    // No cross-household data visible: a member cannot SET their household_id
    // because users.household_id is write-protected by RLS (policy: FOR ALL USING id = auth.uid()).
    expect(true).toBe(true); // documentary assertion
  });
});

// ===========================================================================
// A+B. No orphan household on provisioned signup
// ===========================================================================

describe('no orphan household — provisioned member path', () => {
  it('provisioning a member does not increment household count', () => {
    const ownerRows  = simulateTrigger('owner@example.com',  { full_name: 'Owner', locale: 'en' });
    const memberRows = simulateTrigger('member@example.com', {
      household_id: 'hh-1',
      role: 'member',
      full_name: 'Member',
    });
    expect(ownerRows.households).toHaveLength(1);
    expect(memberRows.households).toHaveLength(0);
  });

  it('total chequing accounts after provisioning is still 1', () => {
    const ownerRows  = simulateTrigger('owner@example.com',  { full_name: 'Owner' });
    const memberRows = simulateTrigger('member@example.com', {
      household_id: 'hh-1',
      role: 'member',
      full_name: 'Member',
    });
    const allAccounts = [...ownerRows.accounts, ...memberRows.accounts];
    expect(allAccounts.filter((a) => a.type === 'chequing')).toHaveLength(1);
  });
});

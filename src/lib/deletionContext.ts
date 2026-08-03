import {
  decideDeletion,
  type DeletionMember,
  type DeletionVerdict,
} from '@/lib/accountDeletionHelpers';

// ---------------------------------------------------------------------------
// Assembles everything the deletion surfaces need, once, from the database.
//
// Three callers read this — the preview endpoint, DELETE /api/me and
// DELETE /api/household — and they MUST agree. A confirmation screen that says
// "you may delete this household" while the route disagrees is worse than
// either behaviour on its own, so the verdict is computed here and the routes
// re-check it rather than re-deriving it.
//
// The blast-radius numbers come from household_deletion_preview() in the
// database rather than being counted here, so the figures a family is shown
// before destroying their data have exactly one source.
// ---------------------------------------------------------------------------

// Minimal structural type — only the surface we actually use. Same approach as
// eventLogger's EventClient: the real Supabase client's builder types are far
// too elaborate to restate here, and a hand-written approximation of them fails
// to accept the genuine article. Compatible with both the real service-role
// client and test mocks.
export interface AdminLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // Returns the builder, not a Promise — it is thenable, so `await` works, but
  // it is not assignable to Promise. Typed loosely for the same reason as from().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { last_sign_in_at?: string | null } | null } | null;
      }>;
    };
  };
}

export type BlastRadius = {
  householdName: string | null;
  members: number;
  accounts: number;
  transactions: number;
  recurringItems: number;
  sinkingFunds: number;
  reviews: number;
  monthsOfHistory: number;
  earliestDate: string | null;
};

export type DeletionContext = {
  householdId: string;
  householdName: string | null;
  /** The caller's own household_members row. Null means their account has no member row. */
  selfMemberId: string | null;
  members: (DeletionMember & { name: string })[];
  verdict: DeletionVerdict;
  blastRadius: BlastRadius | null;
};

export async function loadDeletionContext(
  admin: AdminLike,
  userId: string,
  householdId: string
): Promise<DeletionContext | null> {
  // Read through the service-role client throughout. The caller's own client
  // cannot see other members' users rows (the users RLS policy is
  // `id = auth.uid()`), and a role that reads as NULL because of RLS is exactly
  // the bug memberRoleView was written to stop — here it would decide whether a
  // household gets destroyed.
  const { data: memberRows } = await admin
    .from('household_members')
    .select('id, name, user_id, deleted_at')
    .eq('household_id', householdId);

  const { data: userRows } = await admin
    .from('users')
    .select('id, role')
    .eq('household_id', householdId);

  const roleByUserId = new Map(
    ((userRows ?? []) as { id: string; role: string }[]).map((u) => [u.id, u.role])
  );

  const rows = (memberRows ?? []) as {
    id: string; name: string; user_id: string | null; deleted_at: string | null;
  }[];

  // `pending` needs the Admin API per member. Bounded by HOUSEHOLD_MEMBER_CAP,
  // and only for rows that actually have an account.
  const members = await Promise.all(
    rows.map(async (m) => {
      let pending = false;
      if (m.user_id && !m.deleted_at) {
        try {
          const { data: authUser } = await admin.auth.admin.getUserById(m.user_id);
          const lastSignInAt = authUser?.user?.last_sign_in_at ?? null;
          pending = lastSignInAt === null || lastSignInAt === undefined;
        } catch {
          // A failed lookup must not read as "never signed in" — that would
          // make an active person look pending and could open the escape
          // hatch over their head. Treat them as active; decideDeletion then
          // blocks rather than offering deletion.
          pending = false;
        }
      }
      return {
        id: m.id,
        name: m.name,
        user_id: m.user_id,
        deleted_at: m.deleted_at,
        pending,
        users: m.user_id && roleByUserId.has(m.user_id)
          ? { role: roleByUserId.get(m.user_id)! }
          : null,
      };
    })
  );

  const self = members.find((m) => m.user_id === userId && !m.deleted_at);
  if (!self) return null;

  const { data: preview } = await admin.rpc('household_deletion_preview', {
    p_household_id: householdId,
  });

  const blast = (preview ?? null) as BlastRadius | null;

  return {
    householdId,
    householdName: blast?.householdName ?? null,
    selfMemberId: self.id,
    members,
    verdict: decideDeletion(members, self.id),
    blastRadius: blast,
  };
}

# A sign-up can join any household, as owner, through its metadata

**Filed** 2026-11-05, found while preparing in-app sign-up (S1).

**Status:** FIXED AND PROVEN LIVE 2026-11-05 (2deeeda + migration
20261105010000, VERIFY 10/10): a real invite joins; a sign-up forging a
household in its metadata gets its own. Test accounts all deleted.
Earlier: SECOND FIX BUILT 2026-11-05 (Lineu: "yes invite fix"). The first fix (20261105000000, app_metadata) closed the hole
but broke invites — app_metadata is set after the trigger fires. Now: a
server-only `member_invites` table written before the account exists, read
and consumed by the trigger; the route reads back where the account landed
and refuses to report success otherwise (8/8 mutants caught). Migration
`20261105010000_member_invites.sql` WRITTEN, not applied. Until it and the
deploy are both live, invites don't work: send none.
Earlier: FIX BUILT 2026-11-05 (Lineu: "yes security").
Invite route writes `app_metadata` (3/3 mutants caught); migration
`20261105000000_handle_new_user_app_metadata.sql` WRITTEN, not applied —
apply it AFTER the invite change is deployed. Still to do after applying: the
live test in step 3 below.

## The problem

`handle_new_user` (live body md5 3552de0f65e1a14014472a995e865380) takes
"Path B — provisioned member" whenever `raw_user_meta_data->>'household_id'`
is set, and uses `raw_user_meta_data->>'role'` as the role:

```sql
provisioned_household_id := NEW.raw_user_meta_data->>'household_id';
...
provisioned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'member');
INSERT INTO users (id, household_id, email, full_name, role) VALUES (..., provisioned_household_id::uuid, ..., provisioned_role);
```

`raw_user_meta_data` is what the CLIENT sends: `supabase.auth.signUp({ ...,
options: { data: { household_id, role: 'owner' } } })` with the public key.
Anyone who knows a household's id can create an account inside it, as an
owner, and read every figure it has. Email confirmation doesn't stop it: the
trigger runs when the auth user is created, and the attacker confirms their
own address.

Who knows a household id: every member, past and present (`/api/me` returns
it), including a removed member.

## Exposure (read 2026-11-05)

Only two users ever joined an existing household: 2be22642's second owner
(2026-07-15) and Ridge Hazel in Zezinho Test (2026-11-05, today's test
invite). Both are real invites. No sign of abuse.

## The fix (proposed)

`raw_app_meta_data` can only be written with the service role. So:

1. Invite route (`POST /api/household/members`, `admin.auth.admin.createUser`):
   also write `app_metadata: { household_id, role }`. Deploy this first.
2. Migration: `handle_new_user` reads `household_id` and `role` from
   `NEW.raw_app_meta_data` only. Same migration adds `platform` to the
   `signup` event (S1). Check the full body survived with `SELECT prosrc`.
3. Test live with a throwaway account: a public sign-up sending
   `household_id` gets a new household of its own; a real invite still joins.

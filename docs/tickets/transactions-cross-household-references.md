# A transaction can point at another household's account or category

**Filed** 2026-09-28, from the mobile V1 Phase 1 diagnosis
([docs/mobile-v1-phase1.md](../mobile-v1-phase1.md), out-of-scope bug 3).

**Status:** API path CLOSED (37740fa). Database path: migration WRITTEN, NOT
APPLIED — [supabase/migrations/20260928000000_transactions_same_household_refs.sql](../../supabase/migrations/20260928000000_transactions_same_household_refs.sql).

**Severity:** medium. Cross-tenant write, not read: a household cannot see
another's data through this, but can put rows into another household's figures.

---

## The problem

The only policy on `transactions`, read live 2026-09-28:

```
"Users see household transactions"  FOR ALL
  USING (household_id IN (SELECT household_id FROM users WHERE id = auth.uid()))
```

It proves the row's `household_id` is the caller's. It does not look at
`account_id` or `category_id`. The foreign keys prove only that the target
exists. So a signed-in user can insert a row that is theirs by
`household_id` but sits on another household's credit card — moving that
card's Spent and Room in the other household's card room, on a row the other
household cannot see or delete.

## Why the route fix is not enough

`POST /api/expenses` now checks both ids against the caller's household
(37740fa). But every signed-in client holds a user JWT and the public anon
key, which is all PostgREST needs. The route can be skipped.

## The migration

A `SECURITY DEFINER` trigger, `BEFORE INSERT OR UPDATE OF household_id,
account_id, bridge_source_account, category_id`, refusing (42501) any
reference to another household's account or category. VERIFY block included.

Production before writing it: zero existing rows reference another
household's account, category, member or recurring rule.

## Follow-up, not in the migration

Also household-owned references on `transactions`, not yet guarded:
`member_id`, `recurring_item_id`, `file_import_id`, `transfer_peer_id`. Each
has writers (save-plan, `create_transfer`, rule materialisation) that should
be read before a trigger is allowed to refuse them.

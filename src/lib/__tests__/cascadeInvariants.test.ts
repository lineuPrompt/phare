import { describe, it, expect } from 'vitest';
import { parseSchema, deleteRuleFor, cascadePathsFrom, type ForeignKey } from './schemaFromMigrations';

/**
 * Pins the ON DELETE rules that the account-deletion semantics depend on.
 *
 * The agreed semantics are: identity erased, household ledger preserved,
 * provenance survives the person. Each rule below is load-bearing for one of
 * those three, and every one of them is a single word in a migration that a
 * future ALTER TABLE could flip without any test noticing — which is exactly
 * how file_imports.uploaded_by came to be CASCADE.
 *
 * These are invariants, not descriptions. If one fails, the question is not
 * "update the test" — it is "does account deletion still do what we agreed".
 */

const { foreignKeys } = parseSchema();

describe('cascade invariants for account deletion', () => {
  it('parses delete rules at all, in every declaration form', () => {
    // Vacuity guard. Without this the whole file passes when parsing breaks.
    expect(foreignKeys.length).toBeGreaterThan(40);

    const rules = new Set(foreignKeys.map((fk) => fk.onDelete));
    expect(rules.has('CASCADE')).toBe(true);
    expect(rules.has('SET NULL')).toBe(true);
    // NO ACTION is only ever inferred from an ABSENT clause, so its presence
    // proves the default is being applied rather than silently mislabelled.
    expect(rules.has('NO ACTION')).toBe(true);

    // Declared inline in CREATE TABLE…
    expect(deleteRuleFor(foreignKeys, 'household_members', 'household_id')).toBe('CASCADE');
    // …declared by a later ALTER TABLE ADD COLUMN…
    expect(deleteRuleFor(foreignKeys, 'transactions', 'transfer_peer_id')).toBe('SET NULL');
    // …and re-declared by ALTER TABLE ADD CONSTRAINT, which is the form the
    // uploaded_by migration uses and the reason parsing is statement-based.
    expect(deleteRuleFor(foreignKeys, 'file_imports', 'uploaded_by')).toBe('SET NULL');
  });

  it('the schema qualifier is preserved — auth.users is not public.users', () => {
    // Flattening `auth.users` to `users` created a phantom users.id → users
    // self-reference and made auth.users look unreferenced. The whole blast
    // radius was wrong until this was fixed.
    expect(deleteRuleFor(foreignKeys, 'users', 'id')).toBe('CASCADE');
    expect(foreignKeys.find((fk) => fk.table === 'users' && fk.column === 'id')?.target)
      .toBe('auth.users');
    expect(foreignKeys.find((fk) => fk.table === 'events' && fk.column === 'user_id')?.target)
      .toBe('auth.users');
  });

  // ---------------------------------------------------------------------
  // "Provenance survives the person"
  // ---------------------------------------------------------------------
  it('file_imports.uploaded_by is SET NULL, never CASCADE', () => {
    expect(deleteRuleFor(foreignKeys, 'file_imports', 'uploaded_by')).toBe('SET NULL');
  });

  // ---------------------------------------------------------------------
  // "Household content survives the member who generated it"
  // ---------------------------------------------------------------------
  it('conversations.user_id is SET NULL, never CASCADE', () => {
    // conversations rows are assistant-authored household content (onboarding
    // plans and monthly reviews) read by the dashboard scoped to household_id
    // alone. user_id records who triggered generation, not authorship. Under
    // CASCADE, the member who last regenerated the plan deleting their account
    // would wipe the family's review history from everyone's dashboard.
    expect(deleteRuleFor(foreignKeys, 'conversations', 'user_id')).toBe('SET NULL');
  });

  it('conversations still cascade on whole-household deletion', () => {
    // The SET NULL above must not be mistaken for "conversations survive
    // everything" — deleting the household still purges them, and that is the
    // path that satisfies erasure.
    expect(deleteRuleFor(foreignKeys, 'conversations', 'household_id')).toBe('CASCADE');
  });

  // ---------------------------------------------------------------------
  // "Household ledger preserved"
  // ---------------------------------------------------------------------
  it('deleting a member detaches their identity but keeps their member row', () => {
    expect(deleteRuleFor(foreignKeys, 'household_members', 'user_id')).toBe('SET NULL');
  });

  it('transactions.member_id blocks deletion of a member row that has history', () => {
    // NO ACTION (no clause) is what makes the relabel approach necessary
    // rather than optional: the member row physically cannot be deleted while
    // transactions reference it. If this ever became SET NULL or CASCADE, the
    // ledger's member attribution would silently change meaning.
    expect(deleteRuleFor(foreignKeys, 'transactions', 'member_id')).toBe('NO ACTION');
  });

  it('member-attributed rows survive the member, they do not vanish', () => {
    for (const table of ['budgets', 'recurring_items', 'budget_alerts']) {
      expect(deleteRuleFor(foreignKeys, table, 'member_id'), `${table}.member_id`).toBe('SET NULL');
    }
  });

  // ---------------------------------------------------------------------
  // "Identity erased"
  // ---------------------------------------------------------------------
  it('deleting the auth row removes the mirror row that holds email and name', () => {
    expect(deleteRuleFor(foreignKeys, 'users', 'id')).toBe('CASCADE');
  });

  it('a full household deletion reaches every household-scoped table', () => {
    const cascading = cascadePathsFrom(foreignKeys, ['households'])
      .filter((p) => p.fk.onDelete === 'CASCADE' && p.fk.column === 'household_id')
      .map((p) => p.fk.table)
      .sort();

    // Every table carrying household_id must cascade, or a household deletion
    // leaves orphaned personal data behind — the PIPEDA failure mode.
    expect(cascading).toEqual([
      'account_balance_anchors',
      'accounts',
      'budget_alerts',
      'budgets',
      'card_envelope_items',
      'categories',
      'conversations',
      'events',
      'file_imports',
      'household_members',
      'monthly_goals',
      'recurring_items',
      'recurring_skipped_dates',
      'sinking_funds',
      'transactions',
      'users',
    ]);
  });

  // ---------------------------------------------------------------------
  // Teeth. Without this, every assertion above could pass because the
  // detector never rejects anything.
  // ---------------------------------------------------------------------
  it('the rule lookup and the cascade walk actually discriminate', () => {
    const fake: ForeignKey[] = [
      { table: 'file_imports', column: 'uploaded_by', target: 'users', onDelete: 'CASCADE' },
      { table: 'conversations', column: 'user_id', target: 'users', onDelete: 'CASCADE' },
      { table: 'child', column: 'parent_id', target: 'users', onDelete: 'SET NULL' },
      { table: 'grandchild', column: 'child_id', target: 'child', onDelete: 'CASCADE' },
    ];

    // Both fixes read as CASCADE in the pre-migration state, proving the
    // assertions above would have FAILED before the migrations rather than
    // being written to match whatever the schema happens to say now.
    expect(deleteRuleFor(fake, 'file_imports', 'uploaded_by')).toBe('CASCADE');
    expect(deleteRuleFor(fake, 'conversations', 'user_id')).toBe('CASCADE');
    expect(deleteRuleFor(fake, 'file_imports', 'no_such_column')).toBeNull();

    // A SET NULL edge terminates the walk: `child` rows survive, so
    // `grandchild` is NOT in the blast radius of deleting a user.
    const reached = cascadePathsFrom(fake, ['users']).map((p) => p.fk.table);
    expect(reached).toContain('file_imports');
    expect(reached).toContain('child');
    expect(reached).not.toContain('grandchild');
  });
});

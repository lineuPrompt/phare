-- =============================================================================
-- Phare — a durable marker for a stated opening balance. 2026-08-31.
--
-- STATUS: APPLIED — 2026-08-31.
--
--   Verified by direct read of production, not by assumption. What was
--   actually confirmed (read-only, via PostgREST):
--     * transactions.is_opening_balance selectable          — column is live
--     * exactly 1 flagged row: "Credit Line", type=debt,
--       2026-07-17, -$500.00, type='transfer'               — backfill correct
--     * 0 flagged rows on a non-goal account
--     * 0 flagged rows whose type is not 'transfer'
--     * 0 'Balance correction' rows marked                  — nothing over-swept
--     * 0 accounts holding more than one flagged row
--
--   NOT confirmable that way: the unique index and the trigger. PostgREST
--   cannot read pg_catalog, and proving the trigger fires requires an insert
--   that must be rejected. The VERIFY block at the foot of this file is what
--   establishes both — it runs inside BEGIN/ROLLBACK and leaves nothing
--   behind. Until it has been run and its six NOTICEs read, treat the index
--   and trigger as present-but-unproven.
--
--   Superseded banner, kept as history — until 2026-08-31 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- WHY THIS COLUMN EXISTS. Households arrive with money already in their goal
-- accounts. That is recorded as a one-sided 'transfer' row on the goal
-- account with NO chequing peer, so the money sums into the balance
-- (computeGoalBalance) without ever becoming a movement out of chequing on
-- the Cash Timeline. The mechanism has shipped since Build 3 and is written
-- by exactly two places: POST /api/accounts and save-plan's "Saved so far".
--
-- The problem was identifying such a row afterwards. Its only distinguishing
-- feature was the literal description 'Starting balance / Solde initial' —
-- a USER-EDITABLE field on a row the household can already rename from the
-- goal's history list. Editing or deleting an opening balance by matching on
-- that string would silently target the wrong row, or no row, the moment
-- anyone retitled it. Hence a real column.
--
-- It also lets the label be rendered from i18n at display time instead of
-- shipping the bilingual literal to both locales.
--
-- WHY A PARTIAL UNIQUE INDEX. An account has at most ONE stated starting
-- position. The edit path upserts rather than appends (an opening balance is
-- an assertion about where the household began, not a record of an event —
-- correcting a typo must not fabricate a second "movement"). The index is
-- what makes "the" opening-balance row a well-defined thing to upsert.
--
-- WHY A TRIGGER AND NOT A CHECK. The rule "an opening balance may exist only
-- on a goal account" spans two tables (transactions.account_id → accounts.type),
-- which CHECK cannot express. It matters enough to enforce in the database
-- rather than by convention: a positive 'transfer' row on CHEQUING is read as
-- money leaving the account. It inflates savings, cuts net cash flow by the
-- same amount, walks the Timeline's running balance down on top of the anchor
-- that already stated the balance, and shows up as a movement that never
-- happened — the exact thing an opening balance exists to avoid.
--
-- And the monthly reconciliation would NOT flag it. Both derivation paths
-- classify a positive chequing transfer as an outflow, so they agree on the
-- wrong number (measured — see openingBalanceInvariant.test.ts). Nothing
-- downstream would ever raise its hand, which is what makes this worth a
-- trigger. The trigger returns immediately for every ordinary row, so it
-- costs nothing on the hot insert path.
--
-- PRE-APPLICATION STATE, read from production 2026-08-31 before writing this:
--   rows carrying the starting-balance description ...... 1
--     (household 2be22642, "Credit Line", type=debt, transfer, -$500)
--   accounts holding more than one such row ............. 0   (index is safe)
--   such rows on a non-goal account ..................... 0   (trigger is safe)
--   such rows whose type is not 'transfer' .............. 0
--   'Balance correction' rows (must NOT be marked) ...... 0
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. THE MARKER.
-- Additive, defaulted, NOT NULL — every existing row is false until the
-- backfill below says otherwise.
-- -----------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_opening_balance boolean NOT NULL DEFAULT false;


-- -----------------------------------------------------------------------------
-- 2. BACKFILL — ONCE, while the description is still trustworthy.
--
-- Deliberately narrow. All three predicates matter:
--   description  — the only signal that exists today
--   type         — both writers emit 'transfer'; anything else is not ours
--   account type — never mark a row on chequing/card, which would then be
--                  rejected by the trigger below and block the migration
--
-- 'Balance correction' rows (the debt re-baselining delta, a genuinely
-- different concept that stays exactly as it is) are untouched: different
-- description, so they cannot match.
-- -----------------------------------------------------------------------------
UPDATE transactions t
   SET is_opening_balance = true
  FROM accounts a
 WHERE t.account_id = a.id
   AND t.description = 'Starting balance / Solde initial'
   AND t.type = 'transfer'
   AND a.type IN ('savings', 'tfsa', 'rrsp', 'debt')
   AND t.is_opening_balance = false;


-- -----------------------------------------------------------------------------
-- 3. AT MOST ONE PER ACCOUNT.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_one_opening_balance_per_account
  ON transactions (account_id)
  WHERE is_opening_balance;


-- -----------------------------------------------------------------------------
-- 4. GOAL ACCOUNTS ONLY — enforced, not assumed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_opening_balance_account_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  acct_type text;
BEGIN
  -- Ordinary rows leave immediately: no lookup, no cost.
  IF NEW.is_opening_balance IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'An opening balance must belong to an account';
  END IF;

  SELECT type INTO acct_type FROM accounts WHERE id = NEW.account_id;

  IF acct_type IS NULL OR acct_type NOT IN ('savings', 'tfsa', 'rrsp', 'debt') THEN
    RAISE EXCEPTION
      'An opening balance can only be set on a savings, TFSA, RRSP, or debt account (got %). '
      'On chequing it becomes a phantom outflow: it inflates savings, cuts net cash flow, '
      'and appears on the Timeline as a movement that never happened.',
      COALESCE(acct_type, 'unknown account');
  END IF;

  IF NEW.type <> 'transfer' THEN
    RAISE EXCEPTION 'An opening balance must be a transfer row (got %)', NEW.type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_opening_balance_account_type ON transactions;
CREATE TRIGGER trg_enforce_opening_balance_account_type
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_opening_balance_account_type();


-- =============================================================================
-- VERIFY — run in the SQL Editor after applying. Wrapped in a transaction and
-- rolled back, so it proves the constraints fire without leaving data behind.
-- A written migration is not a live one; this is how it becomes live.
--
-- --   BEGIN;
-- --   DO $$
-- --   DECLARE
-- --     hh uuid; goal_id uuid; chq_id uuid; n int;
-- --   BEGIN
-- --     SELECT a.household_id, a.id INTO hh, goal_id
-- --       FROM accounts a WHERE a.type IN ('savings','tfsa','rrsp','debt') LIMIT 1;
-- --     SELECT a.id INTO chq_id
-- --       FROM accounts a WHERE a.household_id = hh AND a.type = 'chequing' LIMIT 1;
-- --
-- --     -- 0. the column exists and defaults false
-- --     INSERT INTO transactions (household_id, account_id, amount, date, type, source, description)
-- --     VALUES (hh, goal_id, 10, CURRENT_DATE, 'transfer', 'manual', 'probe plain');
-- --     SELECT count(*) INTO n FROM transactions
-- --       WHERE description = 'probe plain' AND is_opening_balance = false;
-- --     RAISE NOTICE 'defaults to false: %', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END;
-- --
-- --     -- 1. an opening balance on a GOAL account is accepted
-- --     INSERT INTO transactions (household_id, account_id, amount, date, type, source, description, is_opening_balance)
-- --     VALUES (hh, goal_id, 500, CURRENT_DATE, 'transfer', 'manual', 'probe goal ob', true);
-- --     RAISE NOTICE 'opening balance on a goal account: PASS';
-- --
-- --     -- 2. a SECOND one on the same account is rejected
-- --     BEGIN
-- --       INSERT INTO transactions (household_id, account_id, amount, date, type, source, description, is_opening_balance)
-- --       VALUES (hh, goal_id, 600, CURRENT_DATE, 'transfer', 'manual', 'probe goal ob 2', true);
-- --       RAISE NOTICE 'second opening balance rejected: FAIL';
-- --     EXCEPTION WHEN unique_violation THEN
-- --       RAISE NOTICE 'second opening balance rejected: PASS';
-- --     END;
-- --
-- --     -- 3. THE STRUCTURAL ONE: never on chequing
-- --     IF chq_id IS NULL THEN
-- --       RAISE NOTICE 'chequing rejection: SKIPPED (no chequing account)';
-- --     ELSE
-- --       BEGIN
-- --         INSERT INTO transactions (household_id, account_id, amount, date, type, source, description, is_opening_balance)
-- --         VALUES (hh, chq_id, 500, CURRENT_DATE, 'transfer', 'manual', 'probe chq ob', true);
-- --         RAISE NOTICE 'opening balance on chequing rejected: FAIL';
-- --       EXCEPTION WHEN raise_exception THEN
-- --         RAISE NOTICE 'opening balance on chequing rejected: PASS';
-- --       END;
-- --     END IF;
-- --
-- --     -- 4. UPDATE is guarded too, not only INSERT
-- --     IF chq_id IS NOT NULL THEN
-- --       BEGIN
-- --         INSERT INTO transactions (household_id, account_id, amount, date, type, source, description)
-- --         VALUES (hh, chq_id, 20, CURRENT_DATE, 'transfer', 'manual', 'probe chq flip');
-- --         UPDATE transactions SET is_opening_balance = true WHERE description = 'probe chq flip';
-- --         RAISE NOTICE 'flipping a chequing row rejected: FAIL';
-- --       EXCEPTION WHEN raise_exception THEN
-- --         RAISE NOTICE 'flipping a chequing row rejected: PASS';
-- --       END;
-- --     END IF;
-- --
-- --     -- 5. the backfill marked what it should and nothing else
-- --     SELECT count(*) INTO n FROM transactions
-- --       WHERE description = 'Balance correction' AND is_opening_balance;
-- --     RAISE NOTICE 'no Balance correction row marked: %', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;
-- --
-- --     SELECT count(*) INTO n FROM transactions t JOIN accounts a ON a.id = t.account_id
-- --      WHERE t.is_opening_balance AND a.type NOT IN ('savings','tfsa','rrsp','debt');
-- --     RAISE NOTICE 'no marked row off a goal account: %', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;
-- --   END $$;
-- --   ROLLBACK;
-- =============================================================================

-- =============================================================================
-- Phare — initial schema
-- Reverse-engineered from production on 2026-06-18.
-- Apply to a fresh Supabase project to reproduce the DB from scratch.
-- =============================================================================

-- =============================================================================
-- TABLES
-- =============================================================================

-- Top-level tenant unit. One per family.
CREATE TABLE IF NOT EXISTS households (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  locale              text        NOT NULL DEFAULT 'en'    CHECK (locale IN ('en', 'fr')),
  stripe_customer_id  text,
  subscription_status text                 DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Mirrors auth.users; populated atomically by the handle_new_user trigger.
CREATE TABLE IF NOT EXISTS users (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id uuid        REFERENCES households(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  full_name    text        NOT NULL,
  role         text        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per household member. user_id nullable for invited-but-not-signed-up members.
CREATE TABLE IF NOT EXISTS household_members (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  name           text        NOT NULL,
  monthly_budget numeric(10,2),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Chequing + credit cards per household. Chequing is created by the signup trigger.
CREATE TABLE IF NOT EXISTS accounts (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                text          NOT NULL,
  type                text          NOT NULL CHECK (type IN ('chequing', 'credit_card', 'line_of_credit')),
  balance             numeric(12,2) NOT NULL DEFAULT 0,
  currency            text          NOT NULL DEFAULT 'CAD',
  statement_close_day int           CHECK (statement_close_day BETWEEN 1 AND 31),
  payment_day         int           CHECK (payment_day BETWEEN 1 AND 31),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- 10 seeded expense categories + income, bilingual, user-editable.
-- Individual bills (Spotify, Hydro) are descriptions inside a category, never categories.
CREATE TABLE IF NOT EXISTS categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  name_fr         text,
  type            text        NOT NULL CHECK (type IN ('expense', 'income')),
  icon            text,
  sort_order      int                  DEFAULT 0,
  is_sinking_fund boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Rules that drive materialized recurring transactions (fixed bills & income).
CREATE TABLE IF NOT EXISTS recurring_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id    uuid          REFERENCES household_members(id) ON DELETE SET NULL,
  category_id  uuid          REFERENCES categories(id) ON DELETE SET NULL,
  account_id   uuid          REFERENCES accounts(id) ON DELETE SET NULL,
  description  text          NOT NULL,
  amount       numeric(10,2) NOT NULL,
  type         text          NOT NULL CHECK (type IN ('income', 'expense')),
  cadence      text          NOT NULL CHECK (cadence IN ('monthly', 'biweekly', 'semimonthly')),
  anchor_date  date          NOT NULL,
  second_day   int           CHECK (second_day BETWEEN 1 AND 31),
  active       boolean       NOT NULL DEFAULT true,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- Every individual money movement (manual, materialized recurring, bridge, imported).
CREATE TABLE IF NOT EXISTS transactions (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id             uuid          NOT NULL REFERENCES household_members(id),
  account_id            uuid          REFERENCES accounts(id) ON DELETE SET NULL,
  category_id           uuid          REFERENCES categories(id) ON DELETE SET NULL,
  recurring_item_id     uuid          REFERENCES recurring_items(id) ON DELETE SET NULL,
  amount                numeric(10,2) NOT NULL,
  description           text,
  date                  date          NOT NULL,
  type                  text          NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  source                text                   DEFAULT 'manual' CHECK (source IN ('manual', 'screenshot', 'csv', 'excel', 'bridge')),
  recurrence_id         uuid,
  installment_label     text,
  is_bridge             boolean       NOT NULL DEFAULT false,
  bridge_source_account uuid          REFERENCES accounts(id) ON DELETE SET NULL,
  bridge_source_month   text          CHECK (bridge_source_month ~ '^\d{4}-\d{2}$'),
  created_at            timestamptz   NOT NULL DEFAULT now()
);

-- At most one bridge payment row per card per spending month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_unique
  ON transactions (household_id, bridge_source_account, bridge_source_month)
  WHERE is_bridge = true;

-- Planned spending per variable-expense category per month.
-- month is always stored as YYYY-MM-01.
CREATE TABLE IF NOT EXISTS budgets (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id  uuid          NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  member_id    uuid          REFERENCES household_members(id) ON DELETE SET NULL,
  month        date          NOT NULL,
  amount       numeric(10,2) NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (household_id, category_id, member_id, month)
);

-- Annual expenses spread as monthly provisions (e.g. car registration, vacation).
CREATE TABLE IF NOT EXISTS sinking_funds (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name              text          NOT NULL,
  annual_amount     numeric(10,2) NOT NULL,
  monthly_provision numeric(10,2),
  current_balance   numeric(10,2) NOT NULL DEFAULT 0,
  due_month         int           CHECK (due_month BETWEEN 1 AND 12),
  due_day           int           CHECK (due_day BETWEEN 1 AND 31),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- Savings goals per household.
CREATE TABLE IF NOT EXISTS goals (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name           text          NOT NULL,
  target_amount  numeric(10,2) NOT NULL,
  current_amount numeric(10,2) NOT NULL DEFAULT 0,
  target_date    date,
  status         text                   DEFAULT 'active' CHECK (status IN ('active', 'reached', 'paused')),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

-- Per-month card spending targets. month is always YYYY-MM-01.
CREATE TABLE IF NOT EXISTS monthly_goals (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month        date          NOT NULL,
  card_goal    numeric(10,2) NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (household_id, month)
);

-- AI-generated onboarding summaries, monthly reviews, and chat sessions.
CREATE TABLE IF NOT EXISTS conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('onboarding', 'monthly_review', 'chat')),
  messages     jsonb       NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Budget threshold alerts (80% or 100% of category budget reached).
CREATE TABLE IF NOT EXISTS budget_alerts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id  uuid        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  member_id    uuid        REFERENCES household_members(id) ON DELETE SET NULL,
  threshold    int         NOT NULL CHECK (threshold = ANY (ARRAY[80, 100])),
  month        date        NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  read         boolean              DEFAULT false
);

-- Uploaded spreadsheet/bank file imports.
CREATE TABLE IF NOT EXISTS file_imports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name    text        NOT NULL,
  file_type    text        NOT NULL CHECK (file_type IN ('csv', 'excel', 'screenshot')),
  storage_path text        NOT NULL,
  status       text                 DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  row_count    int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- INDEXES (matches production exactly)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_accounts_household          ON accounts          (household_id);
CREATE INDEX IF NOT EXISTS idx_alerts_household_month      ON budget_alerts      (household_id, month);
CREATE INDEX IF NOT EXISTS idx_budgets_household_month     ON budgets            (household_id, month);
CREATE INDEX IF NOT EXISTS idx_categories_household        ON categories         (household_id);
CREATE INDEX IF NOT EXISTS idx_conversations_household     ON conversations      (household_id);
CREATE INDEX IF NOT EXISTS idx_file_imports_household      ON file_imports       (household_id);
CREATE INDEX IF NOT EXISTS idx_goals_household             ON goals              (household_id);
CREATE INDEX IF NOT EXISTS idx_members_household           ON household_members  (household_id);
CREATE INDEX IF NOT EXISTS idx_monthly_goals_household_month ON monthly_goals    (household_id, month);
CREATE INDEX IF NOT EXISTS idx_recurring_account           ON recurring_items    (account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_household         ON recurring_items    (household_id);
CREATE INDEX IF NOT EXISTS idx_sinking_funds_household     ON sinking_funds      (household_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account        ON transactions       (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category       ON transactions       (category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON transactions       (household_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_member         ON transactions       (member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recurrence     ON transactions       (recurrence_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recurring_item ON transactions       (recurring_item_id);
CREATE INDEX IF NOT EXISTS idx_users_household             ON users              (household_id);

-- =============================================================================
-- UPDATED_AT AUTO-MAINTENANCE
-- Only on tables that actually have an updated_at column.
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER set_households_updated_at
  BEFORE UPDATE ON households        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_household_members_updated_at
  BEFORE UPDATE ON household_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_accounts_updated_at
  BEFORE UPDATE ON accounts          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_recurring_items_updated_at
  BEFORE UPDATE ON recurring_items   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_sinking_funds_updated_at
  BEFORE UPDATE ON sinking_funds     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_goals_updated_at
  BEFORE UPDATE ON goals             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON conversations     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE households       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinking_funds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_goals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_imports     ENABLE ROW LEVEL SECURITY;

-- Stable helper: returns the household_id for the authenticated user.
-- SECURITY DEFINER so it bypasses RLS on the users table itself.
CREATE OR REPLACE FUNCTION auth_household_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT household_id FROM public.users WHERE id = auth.uid()
$$;

-- households: caller can only see/update their own
CREATE POLICY "households_select" ON households
  FOR SELECT USING (id = auth_household_id());
CREATE POLICY "households_update" ON households
  FOR UPDATE USING (id = auth_household_id());

-- users: each user sees and modifies only their own row
CREATE POLICY "users_all" ON users
  FOR ALL USING (id = auth.uid());

-- All remaining tables are household-scoped
CREATE POLICY "household_members_all" ON household_members
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "accounts_all" ON accounts
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "categories_all" ON categories
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "recurring_items_all" ON recurring_items
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "transactions_all" ON transactions
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "budgets_all" ON budgets
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "sinking_funds_all" ON sinking_funds
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "goals_all" ON goals
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "monthly_goals_all" ON monthly_goals
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "conversations_all" ON conversations
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "budget_alerts_all" ON budget_alerts
  FOR ALL USING (household_id = auth_household_id());
CREATE POLICY "file_imports_all" ON file_imports
  FOR ALL USING (household_id = auth_household_id());

-- =============================================================================
-- SIGNUP TRIGGER — handle_new_user
-- Fires AFTER INSERT ON auth.users.
-- Creates household → user row → household member → chequing account atomically.
-- The entire signup rolls back if any step fails.
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_household_id uuid;
  member_name      text;
BEGIN
  member_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

  INSERT INTO households (name, locale)
    VALUES (
      member_name,
      COALESCE(NEW.raw_user_meta_data->>'locale', 'en')
    )
    RETURNING id INTO new_household_id;

  INSERT INTO users (id, household_id, email, full_name, role)
    VALUES (NEW.id, new_household_id, NEW.email, member_name, 'owner');

  INSERT INTO household_members (household_id, user_id, name)
    VALUES (new_household_id, NEW.id, member_name);

  INSERT INTO accounts (household_id, name, type)
    VALUES (new_household_id, 'Chequing', 'chequing');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

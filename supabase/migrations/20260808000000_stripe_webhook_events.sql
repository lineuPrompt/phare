-- =============================================================================
-- Phare — webhook idempotency and event ordering. 2026-08-05.
--
-- STATUS: APPLIED — verified live in production on 2026-08-05, 8/8 checks PASS.
--   Table present with the Stripe event id as a text primary key; NO foreign
--   key on household_id (an FK there would refuse to store the orphan case this
--   table most needs to record); both orphan-cancellation columns present; RLS
--   enabled with NO policy, so the table is reachable only by the service-role
--   client; households.subscription_updated_at present and nullable; both
--   indexes created; and no events recorded yet, which is correct before any
--   webhook has been delivered.
--
--   Superseded banner, kept as history — until 2026-08-05 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- Piece 5 of the payment build. One table, one column.
--
-- The webhook is the ONLY writer of subscription state. Everything here exists
-- to make that single writer safe against the two things Stripe guarantees it
-- will do: deliver the same event more than once, and deliver events out of
-- order.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Idempotency ledger.
--
-- Stripe retries a webhook for up to three days until it gets a 2xx, and will
-- also redeliver on demand from the dashboard. Without a durable record of what
-- has already been handled, a retry re-applies the same state transition — and
-- for a `customer.subscription.deleted` replayed after a re-subscribe, that
-- means revoking access somebody is currently paying for.
--
-- The primary key IS Stripe's event id, so the insert itself is the lock: the
-- handler inserts FIRST, and a unique violation means "already processed, stop".
-- No read-then-write race, no advisory locks, no in-memory set that dies on
-- every deploy and differs per lambda.
--
-- NO FOREIGN KEY ON household_id, and this is deliberate — the same reasoning
-- as member_deletion_requests.subject_user_id. An event can arrive for a
-- household that was deleted between checkout and delivery. That is exactly the
-- case this table most needs to record, so it cannot be a case the schema
-- refuses to store.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  -- Stripe's event.id (evt_...). The idempotency key.
  id                     text        PRIMARY KEY,
  type                   text        NOT NULL,

  -- Plain uuid, no FK. May reference a household that no longer exists.
  household_id           uuid,

  -- The event's OWN timestamp, from Stripe. Ordering is decided by this, never
  -- by arrival time — see subscription_updated_at below.
  event_created_at       timestamptz,
  received_at            timestamptz NOT NULL DEFAULT now(),

  -- What the handler did. Deliberately a free text label rather than an enum:
  -- a CHECK constraint here would mean a schema migration every time a new
  -- outcome is distinguished, and this table is diagnostic, not load-bearing.
  --   applied            — state written
  --   stale_ignored      — an older event arrived after a newer one
  --   duplicate          — never stored (the insert fails instead), listed for
  --                        completeness only
  --   household_missing  — metadata pointed at a household that is gone
  --   orphan_cancelled   — as above, AND the subscription was cancelled
  --   unhandled_type     — subscribed but not acted on
  --   error              — see last_error
  outcome                text,

  -- THE MONEY RECORD. When an event arrives for a deleted household and the
  -- subscription is auto-cancelled, these make it PROVABLE rather than only
  -- logged. A log line is not evidence six months later when someone asks why
  -- their card stopped being charged, and it is not queryable when asking
  -- "did we ever fail to cancel one of these?".
  orphan_subscription_id text,
  orphan_cancelled_at    timestamptz,

  last_error             text
);

-- Ops: newest first, and cheap pruning later if this table ever grows.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received
  ON stripe_webhook_events (received_at DESC);

-- The money question — "which subscriptions did we auto-cancel, and did any
-- fail?" — asked over a small partial set rather than the whole table.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_orphans
  ON stripe_webhook_events (received_at DESC)
  WHERE orphan_subscription_id IS NOT NULL;

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- NO POLICY, deliberately. RLS enabled with no policy denies every normal
-- client outright. This table is written and read by the service-role client
-- only: it is operator data, it can reference deleted households, and it must
-- not be scoped to a household that may not exist.


-- -----------------------------------------------------------------------------
-- 2. Ordering guard.
--
-- Stripe does not guarantee delivery order. A customer.subscription.updated can
-- and does arrive before the customer.subscription.created it follows, and a
-- retry of an old event can land after a newer one has already been applied.
-- Applying whatever arrived last would silently roll state backwards — e.g.
-- restoring `active` over a `canceled` that came first, handing out access
-- nobody is paying for.
--
-- So the writer records the EVENT's own timestamp here, and refuses any write
-- whose event is older than this value. Last-writer-wins by event time, not by
-- arrival time.
--
-- Nullable: every household that predates billing has never had an event, and
-- NULL correctly means "no event has been applied yet", so the first one always
-- wins.
-- -----------------------------------------------------------------------------
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS subscription_updated_at timestamptz;

-- =============================================================================
-- VERIFY — run after applying. Expect every row PASS.
-- =============================================================================
--
-- WITH checks AS (
--   SELECT 'stripe_webhook_events table exists' AS check_name,
--          CASE WHEN to_regclass('public.stripe_webhook_events') IS NOT NULL
--               THEN 'PASS' ELSE 'FAIL' END AS status
--   UNION ALL
--   SELECT 'primary key is the Stripe event id (text)',
--          CASE WHEN EXISTS (
--                SELECT 1 FROM information_schema.columns
--                 WHERE table_schema='public' AND table_name='stripe_webhook_events'
--                   AND column_name='id' AND data_type='text' AND is_nullable='NO')
--            AND EXISTS (
--                SELECT 1 FROM information_schema.table_constraints
--                 WHERE table_schema='public' AND table_name='stripe_webhook_events'
--                   AND constraint_type='PRIMARY KEY')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'household_id has NO foreign key (must store deleted households)',
--          CASE WHEN NOT EXISTS (
--                SELECT 1 FROM pg_constraint con
--                  JOIN pg_class rel ON rel.oid = con.conrelid
--                 WHERE rel.relname='stripe_webhook_events' AND con.contype='f')
--               THEN 'PASS' ELSE 'FAIL — an FK here would refuse the orphan case' END
--   UNION ALL
--   SELECT 'orphan cancellation columns present',
--          CASE WHEN (SELECT count(*) FROM information_schema.columns
--                      WHERE table_schema='public' AND table_name='stripe_webhook_events'
--                        AND column_name IN ('orphan_subscription_id','orphan_cancelled_at')) = 2
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'RLS enabled with NO policy (service-role only)',
--          CASE WHEN (SELECT relrowsecurity FROM pg_class
--                      WHERE oid = to_regclass('public.stripe_webhook_events'))
--                AND NOT EXISTS (SELECT 1 FROM pg_policies
--                      WHERE schemaname='public' AND tablename='stripe_webhook_events')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'households.subscription_updated_at (timestamptz, nullable)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='subscription_updated_at'
--                  AND data_type='timestamp with time zone' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'both indexes present',
--          CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
--                      AND indexname IN ('idx_stripe_webhook_events_received',
--                                        'idx_stripe_webhook_events_orphans')) = 2
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'no events recorded yet',
--          CASE WHEN NOT EXISTS (SELECT 1 FROM stripe_webhook_events)
--               THEN 'PASS' ELSE 'FAIL — nothing should have arrived yet' END
-- )
-- SELECT * FROM checks ORDER BY status, check_name;

-- OPS: did we ever auto-cancel an orphan, and did any fail?
--   SELECT id, type, household_id, orphan_subscription_id,
--          orphan_cancelled_at, outcome, last_error, received_at
--     FROM stripe_webhook_events
--    WHERE orphan_subscription_id IS NOT NULL
--    ORDER BY received_at DESC;
--   -- orphan_cancelled_at NULL on such a row = a subscription still billing
--   -- a household that no longer exists. Cancel it by hand in Stripe.

-- OPS: recent webhook activity and anything that errored.
--   SELECT id, type, outcome, last_error, event_created_at, received_at
--     FROM stripe_webhook_events ORDER BY received_at DESC LIMIT 50;
-- =============================================================================

-- Seed the App Store review demo household's card plans and expenses
-- (runbook 4.3). Demo Household only: cceaee4b-8e8d-46e1-b8c8-2d743e2f6563.
-- Run once in the Supabase SQL Editor, then press Regenerate on the web.
-- Expected after: Visa Oct cycle (Sep 21 - Oct 20) $935.10 vs goal 900;
-- Groceries & Pharmacy $688.85 vs 500; Restaurants $174.95 vs 200.

-- BEFORE: expect close/pay '-' on both cards, and 0 / 0 / 0
SELECT name, statement_close_day, payment_day
  FROM accounts
 WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
 ORDER BY name;
SELECT (SELECT count(*) FROM monthly_goals       WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563') AS goals,
       (SELECT count(*) FROM card_envelope_items WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563') AS envelopes,
       (SELECT count(*) FROM transactions        WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
                                                   AND source = 'manual' AND recurring_item_id IS NULL) AS manual_tx;

BEGIN;

-- Visa: close 20, pay 10 (expect 1 row)
UPDATE accounts SET statement_close_day = 20, payment_day = 10
 WHERE id = '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'
   AND household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';

-- Mastercard: close 5, pay 25 (expect 1 row)
UPDATE accounts SET statement_close_day = 5, payment_day = 25
 WHERE id = 'ceaf67f2-5264-4771-a497-a445cd0dbcc5'
   AND household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';

-- Visa October goal 900 (expect 1 row)
INSERT INTO monthly_goals (household_id, account_id, month, card_goal)
SELECT a.household_id, a.id, DATE '2026-10-01', 900
  FROM accounts a
 WHERE a.id = '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'
   AND a.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';

-- Visa October budgets: Groceries & Pharmacy 500, Restaurants 200 (expect 2 rows)
INSERT INTO card_envelope_items (household_id, account_id, category_id, month, monthly_amount)
SELECT a.household_id, a.id, c.id, DATE '2026-10-01', v.amount
  FROM (VALUES ('1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 500),
               ('cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid, 200)) AS v(category_id, amount)
  JOIN accounts   a ON a.id = '09ebda29-4dd0-4520-a0a3-630b2dc5c56e' AND a.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
  JOIN categories c ON c.id = v.category_id                          AND c.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';

-- 15 card expenses, no member attribution (expect 15 rows)
INSERT INTO transactions (household_id, member_id, account_id, category_id, amount, description, date, type, source)
SELECT a.household_id, NULL, a.id, c.id, v.amount, v.description, v.date, 'expense', 'manual'
  FROM (VALUES
    (DATE '2026-08-28', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'IGA',           '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 142.30),
    (DATE '2026-09-05', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Bistro',        'cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid,  58.40),
    (DATE '2026-09-12', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Costco',        '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 211.75),
    (DATE '2026-09-17', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Gas',           '5a34ffbb-fb23-47a7-9358-e96e25a13fa0'::uuid,  66.10),
    (DATE '2026-09-20', 'ceaf67f2-5264-4771-a497-a445cd0dbcc5'::uuid, 'Winners',       '90964928-cc6b-43e9-b255-cec0cc91fe57'::uuid,  79.99),
    (DATE '2026-09-24', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'IGA',           '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 186.40),
    (DATE '2026-09-29', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Pizzeria',      'cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid,  64.25),
    (DATE '2026-10-03', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Costco',        '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 298.90),
    (DATE '2026-10-07', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Sushi',         'cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid,  92.10),
    (DATE '2026-10-08', 'ceaf67f2-5264-4771-a497-a445cd0dbcc5'::uuid, 'Canadian Tire', '90964928-cc6b-43e9-b255-cec0cc91fe57'::uuid,  54.99),
    (DATE '2026-10-09', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Pharmaprix',    '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid,  38.75),
    (DATE '2026-10-11', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Gas',           '5a34ffbb-fb23-47a7-9358-e96e25a13fa0'::uuid,  71.30),
    (DATE '2026-10-12', 'ceaf67f2-5264-4771-a497-a445cd0dbcc5'::uuid, 'Tim Hortons',   'cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid,  12.45),
    (DATE '2026-10-13', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Metro',         '1b303807-0466-4328-9151-878dbb3bcbd9'::uuid, 164.80),
    (DATE '2026-10-14', '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'::uuid, 'Café',          'cd72cd23-0a60-4288-8723-4b0b81ba06de'::uuid,  18.60)
  ) AS v(date, account_id, description, category_id, amount)
  JOIN accounts   a ON a.id = v.account_id  AND a.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
  JOIN categories c ON c.id = v.category_id AND c.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';

-- Guard: if any count is off, raise, and the whole transaction rolls back
DO $$
DECLARE g int; e int; t int; s numeric;
BEGIN
  SELECT count(*) INTO g FROM monthly_goals       WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';
  SELECT count(*) INTO e FROM card_envelope_items WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';
  SELECT count(*), coalesce(sum(amount), 0) INTO t, s FROM transactions
   WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563' AND source = 'manual' AND recurring_item_id IS NULL;
  IF g <> 1 OR e <> 2 OR t <> 15 OR s <> 1561.08 THEN
    RAISE EXCEPTION 'Demo seed mismatch: goals=% envelopes=% tx=% sum=% (expected 1, 2, 15, 1561.08)', g, e, t, s;
  END IF;
END $$;

COMMIT;

-- VERIFY 1: Visa 20/10, Mastercard 5/25
SELECT name, statement_close_day, payment_day
  FROM accounts
 WHERE household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
 ORDER BY name;

-- VERIFY 2: Visa Oct cycle (Sep 21 - Oct 20) total 935.10;
-- Groceries & Pharmacy 688.85, Restaurants 174.95, Transportation 71.30
SELECT coalesce(c.name, 'TOTAL') AS category, sum(t.amount) AS spent
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
 WHERE t.household_id = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563'
   AND t.account_id = '09ebda29-4dd0-4520-a0a3-630b2dc5c56e'
   AND t.date BETWEEN DATE '2026-09-21' AND DATE '2026-10-20'
   AND t.type = 'expense'
 GROUP BY ROLLUP (c.name)
 ORDER BY c.name NULLS LAST;

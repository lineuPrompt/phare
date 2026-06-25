-- Children / leaf tables first
DELETE FROM budget_alerts;
DELETE FROM file_imports;
DELETE FROM transactions;
DELETE FROM budgets;
DELETE FROM monthly_goals;
DELETE FROM recurring_items;
DELETE FROM sinking_funds;
DELETE FROM goals;
DELETE FROM categories;
DELETE FROM accounts;
DELETE FROM conversations;
DELETE FROM events;
-- Then membership, then users, then households last
DELETE FROM household_members;
DELETE FROM users;
DELETE FROM households;

--verify is zero
SELECT
  (SELECT count(*) FROM households) AS households,
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM transactions) AS transactions,
  (SELECT count(*) FROM accounts) AS accounts,
  (SELECT count(*) FROM budget_alerts) AS budget_alerts,
  (SELECT count(*) FROM file_imports) AS file_imports,
  (SELECT count(*) FROM events) AS events;
-- ---------------------------------------------------------------------------
-- Comp the App Review demo household (docs/ios-submission-runbook.md, part 4).
--
-- Gives the demo household full access until 2027-12-31 without a
-- subscription, so App Review sees whole monthly letters, not the locked
-- notice. Run in the Supabase SQL Editor, top to bottom, after replacing
-- <DEMO_HH> (four places) with the demo household's id.
--
-- NEVER run this with 2be22642 or Zezinho Test (987c63c1). The BEFORE select
-- shows the household's name: stop if it is not "Demo Household".
-- ---------------------------------------------------------------------------

-- BEFORE
SELECT id, name, comp_until, comp_reason, subscription_status
  FROM households
 WHERE id = '<DEMO_HH>';
-- Expect: one row, name "Demo Household", comp_until NULL, subscription_status NULL.

BEGIN;

UPDATE households
   SET comp_until  = '2027-12-31',
       comp_reason = 'App Store review demo'
 WHERE id = '<DEMO_HH>'
   AND id NOT IN ('2be22642-53c5-4599-ad3b-42a076e10484', '987c63c1-034b-4607-8623-d6288ce3d78d');
-- Expect: UPDATE 1

COMMIT;

-- VERIFY
SELECT id, name, comp_until, comp_reason
  FROM households
 WHERE id = '<DEMO_HH>';
-- Expect: comp_until 2027-12-31, comp_reason 'App Store review demo'.

SELECT count(*) AS other_households_comped_today
  FROM households
 WHERE comp_reason = 'App Store review demo'
   AND id <> '<DEMO_HH>';
-- Expect: 0.

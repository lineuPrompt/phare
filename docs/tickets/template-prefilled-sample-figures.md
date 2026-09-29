# The downloadable template ships with someone else's numbers in it

**Filed** 2026-09-29, from the onboarding stranger audit.

**Status:** OPEN. **Severity:** high for the template lane.

`public/phare_template.xlsx` is pre-filled with example figures that the
parser reads as real data:

- Variable Expenses: Groceries 800, Restaurants 350, Gas 50, Pharmacy 150,
  Clothing 335, Kids 100, Personal 100 ×2, Household 150, Entertainment 100
  (≈ $2,235/month).
- Annual Expenses: property tax 3,106.18, registration 350, income tax
  balance 2,000 ("QC + ON tax gap"), back to school 200, Christmas 300, car
  maintenance 600, home maintenance 1,000 (= $7,556.18/year).
- Goals: credit line payoff 5,000, theme park 8,000, Europe 5,000, emergency
  fund 5,000 (two target dates stored as Excel serials 46753 / 47115).

A household that fills in income and fixed bills and leaves the rest
untouched uploads these as its own plan: budgets, sinking funds and goals it
never set. The Example column on the Household sheet is fine (it's a
separate column); the figures above sit in the answer columns.

## The fix

Blank every answer cell (keep labels, headers and the Example column), or
move the examples into a separate example column the parser ignores. Add a
parser test that the shipped file parses to zero variable, annual and goal
lines.

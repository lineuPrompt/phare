/**
 * The ten expense categories every household starts with. One list: save-plan
 * seeds them, /api/plan classifies into them, and the monthly review's
 * category guard scans for them.
 */
export const SEED_EXPENSE_CATEGORIES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
] as const;
export type SeedExpenseCategory = (typeof SEED_EXPENSE_CATEGORIES)[number];

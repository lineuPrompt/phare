export type RecurringItem = {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
  // null when the recurring rule has no known pay date yet (e.g. bi-weekly/
  // semi-monthly income parsed from an import, before an anchor is captured).
  anchor_date: string | null;
  second_day: number | null;
  active: boolean;
  category_id: string | null;
  account_id: string;
  member_id: string | null;
  categories: { name: string } | null;
  accounts: { name: string; type: 'chequing' | 'credit_card' } | null;
  household_members: { name: string } | null;
};

export type RecurringCategory = { id: string; name: string };
export type RecurringAccount = { id: string; name: string; type: 'chequing' | 'credit_card' };

export function formatCurrency(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}

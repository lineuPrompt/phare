export type RecurringItem = {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  cadence: 'monthly' | 'biweekly' | 'semimonthly';
  anchor_date: string;
  second_day: number | null;
  active: boolean;
  category_id: string | null;
  categories: { name: string } | null;
};

export type RecurringCategory = { id: string; name: string };

export function formatCurrency(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}
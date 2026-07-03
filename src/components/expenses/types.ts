export type ExpenseCategory = { id: string; name: string; type: string };

export type Account = {
  id: string;
  name: string;
  type: string;
  statement_close_day?: number | null;
  payment_day?: number | null;
};

export type Expense = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  account_id: string | null;
  is_bridge: boolean | null;
  installment_label: string | null;
  recurrence_id: string | null;
  category_id: string | null;
  categories: { name: string } | null;
  household_members: { name: string } | null;
};

export type SummaryRow = {
  categoryId: string;
  name: string;
  budget: number;
  spent: number;
  difference: number;
};

export type MonthData = {
  month: string;
  accounts: Account[];
  selectedAccount: Account | null;
  expenses: Expense[];
  income: Expense[];
  totalIncome: number;
  summary: SummaryRow[];
  totalSpent: number;
  net: number;
  cardGoal: number | null;
  categories: ExpenseCategory[];
};

export function formatCurrency(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}
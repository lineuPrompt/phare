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

export type MonthData = {
  month: string;
  accounts: Account[];
  selectedAccount: Account | null;
  expenses: Expense[];
  income: Expense[];
  totalIncome: number;
  totalSpent: number;
  net: number;
  cardGoal: number | null;
  categories: ExpenseCategory[];
  // Recurring items on the viewed account with no known pay date yet.
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

export function formatCurrency(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}

// One shared rule for any list mixing money-in and money-out entries
// (a card's transaction list now includes refunds alongside expenses,
// exactly the case this exists for): income is +$X.XX in green, everything
// else is plain currency in the default text color. Locale-safe — the sign
// is a literal "+", not baked into Intl formatting, so it reads correctly
// in both en and fr.
export function formatSignedAmount(
  amount: number,
  type: string,
  locale: string
): { text: string; color: string } {
  const isIncome = type === 'income';
  return {
    text: `${isIncome ? '+' : ''}${formatCurrency(Math.abs(amount), locale)}`,
    color: isIncome ? '#16A34A' : '#0F2044',
  };
}
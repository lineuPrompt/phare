export type Plan = {
  monthlyBudget: {
    totalIncome: number;
    totalExpenses: number;
    totalSavings: number;
    categories: { name: string; budgeted: number; type: string }[];
  };
  sinkingFunds: {
    name: string;
    annualAmount: number;
    monthlyProvision: number;
    dueMonth: string;
  }[];
  debtPayoff: {
    description: string;
    targetDate: string;
    monthlyPayment: number;
  } | null;
  goals: {
    name: string;
    targetAmount: number;
    monthlyContribution: number;
    onTrack: boolean;
    estimatedDate: string;
  }[];
  topRecommendation: string;
};

// Expense form line — label + dollar amount (monthly).
export type FormLine = { label: string; amount: string };

// Income frequency options. Code converts these; users never pre-compute.
export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

// Income form line — captures the paycheque amount and frequency separately.
// monthlyIncomeEquivalent() in src/lib/incomeHelpers.ts converts to monthly.
export type IncomeFormLine = {
  label: string;
  amount: string;       // raw paycheque amount (what lands in the bank each pay)
  frequency: IncomeFrequency;
};

export function formatCAD(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

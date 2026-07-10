export type Plan = {
  monthlyBudget: {
    totalIncome: number;
    totalExpenses: number;
    totalSavings: number;
    categories: {
      name: string;
      budgeted: number;
      type: string;
      // Per-payment identity — set for template-parsed (v2 income / v3
      // expense) lines with a real cadence. budgeted is the monthly
      // equivalent — used for display only when frequency is 'monthly' or
      // absent; a non-monthly item is unanchored at this stage (the anchor
      // step runs after save) and PlanDisplay shows rawAmount + frequency
      // instead, never the average as a stand-in for a real month figure.
      rawAmount?: number;
      frequency?: IncomeFrequency;
      member?: string;
    }[];
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
    // estimatedDate is YYYY-MM (code-computed goals) for template source, or
    // free text for AI-suggested goals (calculated source) — PlanDisplay
    // renders it as given either way.
    estimatedDate: string | null;
    // Present only for code-computed (template-source) goals — absent for
    // AI-suggested (calculated-source) ones, which fall back to the plain
    // on-track/behind rendering with no honest-alternative sentence.
    hasTargetDate?: boolean;
    targetDate?: string | null;
    fundedAlready?: boolean;
    pastDue?: boolean;
    savedSoFar?: number;
  }[];
  topRecommendation: string;
};

// Income frequency options. Code converts these; users never pre-compute.
export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

// Expense form line — captures the per-payment amount and frequency
// separately, same shape and semantics as IncomeFormLine below. Manual and
// template entry must produce indistinguishable ledgers, so a manual
// bi-weekly mortgage needs the same rawAmount+frequency data a template
// row would carry — monthlyEquivalent() converts to monthly for display,
// the anchor step captures a real pay date for non-monthly cadences.
export type FormLine = {
  label: string;
  amount: string;        // raw per-payment amount (what you pay each time)
  frequency: IncomeFrequency;
};

// Income form line — captures the paycheque amount and frequency separately.
// monthlyEquivalent() in src/lib/incomeHelpers.ts converts to monthly.
export type IncomeFormLine = {
  label: string;
  amount: string;       // raw paycheque amount (what lands in the bank each pay)
  frequency: IncomeFrequency;
};

export function formatCAD(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

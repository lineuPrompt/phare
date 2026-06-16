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

export type FormLine = { label: string; amount: string };

export function formatCAD(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}
'use client';

import { useTranslations } from 'next-intl';
import { FormLine, IncomeFormLine, IncomeFrequency, formatCAD } from './types';
import { monthlyEquivalent } from '@/lib/incomeHelpers';

const FREQUENCIES: IncomeFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

export default function ManualForm({
  income,
  setIncome,
  expenses,
  setExpenses,
  statedCombinedAnnual,
  setStatedCombinedAnnual,
  submitting,
  onSubmit,
  onCancel,
}: {
  income: IncomeFormLine[];
  setIncome: (lines: IncomeFormLine[]) => void;
  expenses: FormLine[];
  setExpenses: (lines: FormLine[]) => void;
  statedCombinedAnnual: string;
  setStatedCombinedAnnual: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('upload');

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl p-6" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{t('form.title')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('form.subtitle')}</p>
      </div>

      {/* Income section */}
      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-xl font-bold mb-2" style={{ color: '#0F2044' }}>{t('form.income')}</h3>
        <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{t('form.incomeHint')}</p>

        <div className="space-y-3">
          {income.map((line, i) => {
            const rawAmt = parseFloat(line.amount);
            const monthly = (!isNaN(rawAmt) && rawAmt > 0)
              ? monthlyEquivalent(rawAmt, line.frequency)
              : null;

            return (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap gap-2">
                  {/* Source label */}
                  <input
                    type="text"
                    value={line.label}
                    onChange={(e) => setIncome(income.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
                    placeholder={t('form.sourcePlaceholder')}
                    className="flex-1 min-w-[140px] px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  />
                  {/* Paycheque amount */}
                  <input
                    type="number"
                    value={line.amount}
                    onChange={(e) => setIncome(income.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
                    placeholder={t('form.amountPerPay')}
                    className="w-32 px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  />
                  {/* Frequency */}
                  <select
                    value={line.frequency}
                    onChange={(e) => setIncome(income.map((l, j) => j === i ? { ...l, frequency: e.target.value as IncomeFrequency } : l))}
                    className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white"
                    style={inputStyle}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>{t(`form.freq_${f}`)}</option>
                    ))}
                  </select>
                </div>
                {/* Monthly equivalent — shown as soon as amount is entered */}
                {monthly !== null && (
                  <p className="text-xs pl-1" style={{ color: '#2ABFBF' }}>
                    = {formatCAD(monthly)}{t('form.perMonth')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setIncome([...income, { label: '', amount: '', frequency: 'monthly' }])}
          className="mt-3 text-sm font-medium cursor-pointer"
          style={{ color: '#2ABFBF' }}
        >
          {t('form.addLine')}
        </button>

        {/* Optional: stated combined income — feeds prong (a) of the plausibility guard */}
        <div className="mt-6 pt-5" style={{ borderTop: '1px dashed #E5E7EB' }}>
          <label className="block text-sm font-medium mb-1" style={{ color: '#6B7280' }}>
            {t('form.combinedIncome')}
          </label>
          <input
            type="number"
            value={statedCombinedAnnual}
            onChange={(e) => setStatedCombinedAnnual(e.target.value)}
            placeholder={t('form.combinedIncomePlaceholder')}
            className="w-48 px-4 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>{t('form.combinedIncomeHint')}</p>
        </div>
      </div>

      {/* Expenses section — same per-payment amount + frequency capture as
          income, so a manual bi-weekly mortgage feeds the same anchor-step
          mechanism a template row would. Default frequency is monthly. */}
      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-xl font-bold mb-2" style={{ color: '#0F2044' }}>{t('form.expenses')}</h3>
        <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{t('form.expenseHint')}</p>

        <div className="space-y-3">
          {expenses.map((line, i) => {
            const rawAmt = parseFloat(line.amount);
            const monthly = (!isNaN(rawAmt) && rawAmt > 0)
              ? monthlyEquivalent(rawAmt, line.frequency)
              : null;

            return (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={line.label}
                    onChange={(e) => setExpenses(expenses.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
                    placeholder={t('form.expensePlaceholder')}
                    className="flex-1 min-w-[140px] px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    value={line.amount}
                    onChange={(e) => setExpenses(expenses.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
                    placeholder={t('form.expenseAmountPlaceholder')}
                    className="w-32 px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  />
                  <select
                    value={line.frequency}
                    onChange={(e) => setExpenses(expenses.map((l, j) => j === i ? { ...l, frequency: e.target.value as IncomeFrequency } : l))}
                    className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white"
                    style={inputStyle}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>{t(`form.freq_${f}`)}</option>
                    ))}
                  </select>
                </div>
                {monthly !== null && (
                  <p className="text-xs pl-1" style={{ color: '#2ABFBF' }}>
                    = {formatCAD(monthly)}{t('form.perMonth')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setExpenses([...expenses, { label: '', amount: '', frequency: 'monthly' }])}
          className="mt-3 text-sm font-medium cursor-pointer"
          style={{ color: '#2ABFBF' }}
        >
          {t('form.addLine')}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="px-8 py-3 rounded-full text-white font-semibold text-lg cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
          style={{ background: '#0F2044' }}
        >
          {submitting ? t('confirm.generating') : t('form.submit')}
        </button>
        <button
          onClick={onCancel}
          className="px-8 py-3 rounded-full font-semibold text-lg cursor-pointer hover:opacity-90 transition-all"
          style={{ border: '2px solid #0F2044', color: '#0F2044' }}
        >
          {t('confirm.editBtn')}
        </button>
      </div>
    </div>
  );
}

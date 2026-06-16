'use client';

import { useTranslations } from 'next-intl';
import { FormLine } from './types';

export default function ManualForm({
  income,
  setIncome,
  expenses,
  setExpenses,
  submitting,
  onSubmit,
  onCancel,
}: {
  income: FormLine[];
  setIncome: (lines: FormLine[]) => void;
  expenses: FormLine[];
  setExpenses: (lines: FormLine[]) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('upload');

  const LineSet = ({ lines, setLines, placeholder }: { lines: FormLine[]; setLines: (l: FormLine[]) => void; placeholder: string }) => (
    <>
      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3">
            <input type="text" value={line.label}
              onChange={(e) => setLines(lines.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
              placeholder={placeholder}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
            <input type="number" value={line.amount}
              onChange={(e) => setLines(lines.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
              placeholder="0.00"
              className="w-32 px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          </div>
        ))}
      </div>
      <button onClick={() => setLines([...lines, { label: '', amount: '' }])}
        className="mt-3 text-sm font-medium cursor-pointer" style={{ color: '#2ABFBF' }}>
        {t('form.addLine')}
      </button>
    </>
  );

  return (
    <div className="space-y-8">
      <div className="rounded-2xl p-6" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{t('form.title')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('form.subtitle')}</p>
      </div>

      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('form.income')}</h3>
        <LineSet lines={income} setLines={setIncome} placeholder={t('form.sourcePlaceholder')} />
      </div>

      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('form.expenses')}</h3>
        <LineSet lines={expenses} setLines={setExpenses} placeholder={t('form.expensePlaceholder')} />
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button onClick={onSubmit} disabled={submitting}
          className="px-8 py-3 rounded-full text-white font-semibold text-lg cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
          style={{ background: '#0F2044' }}>
          {submitting ? t('confirm.generating') : t('form.submit')}
        </button>
        <button onClick={onCancel}
          className="px-8 py-3 rounded-full font-semibold text-lg cursor-pointer hover:opacity-90 transition-all"
          style={{ border: '2px solid #0F2044', color: '#0F2044' }}>
          {t('confirm.editBtn')}
        </button>
      </div>
    </div>
  );
}
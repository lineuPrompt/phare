'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecurringItem, formatCurrency } from './types';

export default function RecurringList({
  items,
  locale,
  onChanged,
}: {
  items: RecurringItem[];
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations('recurring.list');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const doDelete = async (id: string) => {
    await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
    setConfirmId(null);
    onChanged();
  };

  const cadenceLabel = (c: string) => t(`cadence.${c}`);

  if (!items.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
        <p style={{ color: '#6B7280' }}>{t('empty')}</p>
      </div>
    );
  }

  const income = items.filter((i) => i.type === 'income');
  const expense = items.filter((i) => i.type === 'expense');

  const Row = ({ item }: { item: RecurringItem }) => (
    <div className="flex items-center gap-3 py-3 px-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: '#0F2044' }}>{item.description}</p>
        <p className="text-xs" style={{ color: '#9CA3AF' }}>
          {cadenceLabel(item.cadence)}{item.categories?.name ? ` · ${item.categories.name}` : ''}
        </p>
      </div>
      <span className="font-bold shrink-0" style={{ color: item.type === 'income' ? '#16A34A' : '#0F2044' }}>
        {item.type === 'income' ? '+' : ''}{formatCurrency(Number(item.amount), locale)}
      </span>
      <button onClick={() => setConfirmId(item.id)}
        className="px-2 py-1 rounded text-xs cursor-pointer shrink-0" style={{ color: '#DC2626' }}>
        {t('delete')}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {income.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#16A34A' }}>{t('incomeTitle')}</h3>
          {income.map((i) => <Row key={i.id} item={i} />)}
        </div>
      )}

      {expense.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#6B7280' }}>{t('expenseTitle')}</h3>
          {expense.map((i) => <Row key={i.id} item={i} />)}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmId && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{t('confirmBody')}</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => doDelete(confirmId)}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer" style={{ background: '#DC2626' }}>
                {t('confirmDelete')}
              </button>
              <button onClick={() => setConfirmId(null)}
                className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer" style={{ color: '#6B7280' }}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
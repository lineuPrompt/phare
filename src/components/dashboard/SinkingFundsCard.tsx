'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SinkingFund, SinkingFundBuffer, formatCurrency, monthName } from './types';
import { useBusinessToday } from '@/lib/useBusinessToday';

type Category = { id: string; name: string };

export default function SinkingFundsCard({
  funds,
  buffer,
  locale,
  onFunded,
}: {
  funds: SinkingFund[];
  buffer: SinkingFundBuffer;
  locale: string;
  // Called after a successful "Start your sinking fund" or "Pay this bill"
  // so the parent can reload the dashboard and pick up the real balance.
  onFunded: () => void;
}) {
  const t = useTranslations('dashboard');
  const { today } = useBusinessToday();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Pay this bill" mini-form state — one fund open at a time. Money always
  // comes from the ONE shared buffer account, never a per-fund account.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payCategoryId, setPayCategoryId] = useState('');
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  if (!funds.length) return null;

  const handleStartFunding = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/sinking-funds/start-funding', { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      onFunded();
    } catch {
      setError(t('startFundingError'));
    } finally {
      setStarting(false);
    }
  };

  const openPayForm = async (fund: SinkingFund) => {
    setPayingId(fund.id);
    setPayError(null);
    setPayAmount(String(fund.annual_amount));
    setPayDate(today);
    setPayCategoryId('');
    if (!categories) {
      try {
        const res = await fetch('/api/categories');
        const json = await res.json();
        setCategories(json.categories ?? []);
      } catch {
        setCategories([]);
      }
    }
  };

  const closePayForm = () => {
    setPayingId(null);
    setPayError(null);
  };

  const submitPay = async (fund: SinkingFund) => {
    if (!buffer.linkedAccountId) return;
    if (!payAmount || !payDate || !payCategoryId) {
      setPayError(t('payFromFundMissingFields'));
      return;
    }
    setPaySubmitting(true);
    setPayError(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: payDate,
          description: fund.name,
          categoryId: payCategoryId,
          amount: Number(payAmount),
          accountId: buffer.linkedAccountId,
          type: 'expense',
        }),
      });
      if (!res.ok) throw new Error('failed');
      setPayingId(null);
      onFunded();
    } catch {
      setPayError(t('payFromFundError'));
    } finally {
      setPaySubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold" style={{ color: '#0F2044' }}>
          {t('sinkingFunds')}
        </h2>
        {buffer.linkedAccountId ? (
          <p className="text-sm font-semibold" style={{ color: buffer.fundedAlready ? '#16A34A' : '#6B7280' }}>
            {t('fundBalance')}: {formatCurrency(buffer.balance, locale)}
          </p>
        ) : (
          <button
            onClick={handleStartFunding}
            disabled={starting}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
            style={{ background: '#F0FDFD', color: '#2ABFBF' }}
          >
            {starting ? t('startingFunding') : t('startFunding', { amount: formatCurrency(buffer.totalMonthlyProvision, locale) })}
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm mb-3" style={{ color: '#DC2626' }}>{error}</p>
      )}
      <div className="space-y-3">
        {funds.map((fund) => (
          <div key={fund.id} className="py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium" style={{ color: '#0F2044' }}>{fund.name}</p>
                <p className="text-sm" style={{ color: '#6B7280' }}>
                  {monthName(fund.due_month, locale)}{fund.due_month ? ' · ' : ''}{formatCurrency(fund.annual_amount, locale)}{t('perYear')}
                </p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-bold" style={{ color: '#2ABFBF' }}>
                  {formatCurrency(fund.monthly_provision, locale)}{t('perMonth')}
                </p>
                {buffer.linkedAccountId && payingId !== fund.id && (
                  <button
                    onClick={() => openPayForm(fund)}
                    className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: '#F0FDFD', color: '#2ABFBF' }}
                  >
                    {t('payFromFund')}
                  </button>
                )}
              </div>
            </div>

            {buffer.linkedAccountId && payingId === fund.id && (
              <div className="mt-3 p-3 rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-2" style={{ background: '#F9FAFB' }}>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid #E5E7EB' }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid #E5E7EB' }}
                />
                <select
                  value={payCategoryId}
                  onChange={(e) => setPayCategoryId(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid #E5E7EB' }}
                >
                  <option value="">{t('payFromFundCategory')}</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => submitPay(fund)}
                    disabled={paySubmitting}
                    className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
                    style={{ background: '#2ABFBF', color: '#FFFFFF' }}
                  >
                    {t('payFromFundConfirm')}
                  </button>
                  <button
                    onClick={closePayForm}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: '#F3F4F6', color: '#6B7280' }}
                  >
                    {t('payFromFundCancel')}
                  </button>
                </div>
                {payError && (
                  <p className="sm:col-span-4 text-xs" style={{ color: '#DC2626' }}>{payError}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

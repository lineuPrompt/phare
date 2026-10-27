'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/dashboard/types';
import { useBusinessToday } from '@/lib/useBusinessToday';

interface Props {
  // Only id and name are read; isDebt decides how a draw is worded. The
  // Reserve Fund passes its account without isDebt — it is never a debt.
  goals: { id: string; name: string; isDebt?: boolean }[];
  defaultGoalId?: string;
  // 'contribution' (default) — chequing → goal, the original behaviour.
  // 'draw' — goal → chequing: borrowing from a debt account, or a
  //   withdrawal from a savings-type account or the Reserve Fund (2026-10-27).
  kind?: 'contribution' | 'draw';
  onSaved: () => void;
  onCancel?: () => void;
}

export default function TransferForm({ goals, defaultGoalId, kind = 'contribution', onSaved, onCancel }: Props) {
  const t = useTranslations('goals');
  const locale = useLocale();
  const { today } = useBusinessToday();

  const [goalId, setGoalId] = useState(defaultGoalId ?? goals[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // A draw from anything but a debt account is a withdrawal.
  const isWithdrawal = kind === 'draw' && goals.find((g) => g.id === goalId)?.isDebt !== true;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goalId || !amount || !date) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    const res = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goalAccountId: goalId,
        amount:        Number(amount),
        date,
        description:   description.trim() || undefined,
        kind,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json();
      // The balance refusal has its own sentence in the household's language;
      // anything else shows the server's own reason.
      setError(
        body.code === 'INSUFFICIENT_BALANCE' && typeof body.available === 'number'
          ? t('withdrawal.insufficient', { amount: formatCurrency(body.available, locale) })
          : body.error ?? 'Error'
      );
      return;
    }

    setAmount('');
    setDescription('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Goal selector — only shown when multiple goals exist */}
      {goals.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {t('transfer.goal')}
          </label>
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044', background: 'white' }}
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Amount */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {t('transfer.amount')}
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {t('transfer.date')}
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
          {t('transfer.description')}
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('transfer.descriptionPlaceholder')}
          className="w-full px-3 py-2 rounded-xl text-sm"
          style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
        />
      </div>

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
      {success && <p className="text-sm font-medium" style={{ color: '#16A34A' }}>{t('transfer.success')}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ border: '1.5px solid #D1D5DB', color: '#6B7280', background: 'white' }}
          >
            {t('transfer.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !amount || !goalId}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{ background: kind === 'draw' ? '#B45309' : '#2ABFBF', color: 'white' }}
        >
          {saving
            ? t('transfer.saving')
            : kind === 'draw'
              ? isWithdrawal ? t('withdrawal.save') : t('draw.save')
              : t('transfer.save')}
        </button>
      </div>
    </form>
  );
}

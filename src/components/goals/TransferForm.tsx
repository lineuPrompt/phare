'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GoalAccount } from '@/components/dashboard/types';
import { useBusinessToday } from '@/lib/useBusinessToday';

interface Props {
  goals: GoalAccount[];
  defaultGoalId?: string;
  onSaved: () => void;
  onCancel?: () => void;
}

export default function TransferForm({ goals, defaultGoalId, onSaved, onCancel }: Props) {
  const t = useTranslations('goals');
  const { today } = useBusinessToday();

  const [goalId, setGoalId] = useState(defaultGoalId ?? goals[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'Error');
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
          style={{ background: '#2ABFBF', color: 'white' }}
        >
          {saving ? t('transfer.saving') : t('transfer.save')}
        </button>
      </div>
    </form>
  );
}

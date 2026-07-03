'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCurrency } from './types';

export default function GoalSetter({
  month,
  accountId,
  currentGoal,
  locale,
  onSaved,
}: {
  month: string;
  accountId: string;
  currentGoal: number | null;
  locale: string;
  onSaved: () => void;
}) {
  const t = useTranslations('expenses.goal');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentGoal?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const goal = parseFloat(value);
    if (!(goal >= 0)) return;
    setSaving(true);
    const res = await fetch('/api/card-goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, cardGoal: goal, accountId }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      onSaved();
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-2xl bg-white p-5" style={{ border: '1px solid #E5E7EB' }}>
        <div>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('label')}</p>
          <p className="text-xl font-bold" style={{ color: '#0F2044' }}>
            {currentGoal !== null ? formatCurrency(currentGoal, locale) : t('notSet')}
          </p>
        </div>
        <button
          onClick={() => { setValue(currentGoal?.toString() ?? ''); setEditing(true); }}
          className="px-4 py-2 rounded-full text-sm font-medium cursor-pointer transition-all hover:opacity-90"
          style={{ border: '1.5px solid #2ABFBF', color: '#2ABFBF' }}
        >
          {currentGoal !== null ? t('edit') : t('set')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-5" style={{ border: '2px solid #2ABFBF' }}>
      <span className="text-sm font-medium" style={{ color: '#0F2044' }}>{t('label')}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium" style={{ color: '#6B7280' }}>$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-32 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="px-4 py-2 rounded-full text-white text-sm font-medium cursor-pointer hover:opacity-90 disabled:opacity-50"
        style={{ background: '#0F2044' }}
      >
        {saving ? '...' : t('save')}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="px-3 py-2 rounded-lg text-sm cursor-pointer"
        style={{ color: '#6B7280' }}
      >
        {t('cancel')}
      </button>
    </div>
  );
}

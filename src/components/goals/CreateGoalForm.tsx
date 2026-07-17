'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type GoalType = 'savings' | 'tfsa' | 'rrsp' | 'debt';

const GOAL_TYPES: GoalType[] = ['savings', 'tfsa', 'rrsp', 'debt'];

interface Props {
  onCreated: () => void;
}

export default function CreateGoalForm({ onCreated }: Props) {
  const t = useTranslations('goals');

  const [name, setName] = useState('');
  const [type, setType] = useState<GoalType>('savings');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [amountOwed, setAmountOwed] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDebt = type === 'debt';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (isDebt && !amountOwed) return;
    setSaving(true);
    setError(null);

    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:            name.trim(),
        type,
        // Debt's payoff target is $0 unless explicitly overridden — climbing
        // from a negative balance toward zero, not toward a positive sum.
        goalTarget:      isDebt ? (goalTarget ? Number(goalTarget) : 0) : (goalTarget ? Number(goalTarget) : null),
        goalTargetDate:  goalTargetDate || null,
        // Opening balance seeds the real starting ledger row — negative for
        // a debt (money already owed before Phare), never entered by the
        // user as negative themselves (they think in terms of "I owe $X").
        openingBalance:  isDebt ? -Math.abs(Number(amountOwed)) : null,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'Error');
      return;
    }

    setName('');
    setType('savings');
    setGoalTarget('');
    setGoalTargetDate('');
    setAmountOwed('');
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
          {t('create.name')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('create.namePlaceholder')}
          required
          className="w-full px-3 py-2 rounded-xl text-sm"
          style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
        />
      </div>

      {/* Account type — radio cards */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: '#0F2044' }}>
          {t('create.type')}
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GOAL_TYPES.map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => setType(gt)}
              className="text-left px-3 py-3 rounded-xl text-sm transition-all"
              style={{
                border: type === gt ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
                background: type === gt ? '#F0FDFD' : 'white',
                color: '#0F2044',
              }}
            >
              <p className="font-semibold">{t(`type.${gt}`)}</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>{t(`typeDesc.${gt}`)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Debt: amount currently owed — seeds the negative opening balance */}
      {isDebt && (
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {t('create.amountOwed')}
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountOwed}
            onChange={(e) => setAmountOwed(e.target.value)}
            placeholder={t('create.amountOwedPlaceholder')}
            required
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>
      )}

      {/* Target amount + date — optional (debt defaults its target to $0, not shown here) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!isDebt && (
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
              {t('create.goalTarget')}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
              placeholder={t('create.goalTargetPlaceholder')}
              className="w-full px-3 py-2 rounded-xl text-sm"
              style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {isDebt ? t('create.payoffDate') : t('create.goalTargetDate')}
          </label>
          <input
            type="date"
            value={goalTargetDate}
            onChange={(e) => setGoalTargetDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

      <button
        type="submit"
        disabled={saving || !name.trim() || (isDebt && !amountOwed)}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: '#0F2044', color: 'white' }}
      >
        {saving ? t('create.saving') : t('create.save')}
      </button>
    </form>
  );
}

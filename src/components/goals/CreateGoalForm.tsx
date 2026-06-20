'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type GoalType = 'savings' | 'tfsa' | 'rrsp';

const GOAL_TYPES: GoalType[] = ['savings', 'tfsa', 'rrsp'];

interface Props {
  onCreated: () => void;
}

export default function CreateGoalForm({ onCreated }: Props) {
  const t = useTranslations('goals');

  const [name, setName] = useState('');
  const [type, setType] = useState<GoalType>('savings');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:            name.trim(),
        type,
        goalTarget:      goalTarget ? Number(goalTarget) : null,
        goalTargetDate:  goalTargetDate || null,
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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

      {/* Target amount + date — optional */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
            {t('create.goalTargetDate')}
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
        disabled={saving || !name.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: '#0F2044', color: 'white' }}
      >
        {saving ? t('create.saving') : t('create.save')}
      </button>
    </form>
  );
}

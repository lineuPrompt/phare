'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GoalAccount } from '@/components/dashboard/types';

// Edits a goal's name, target amount (clearable — "no target" is a valid
// state), target date (clearable), and — for a debt — the amount currently
// owed. The debt amount is corrected via a NEW transaction (the delta
// between the desired balance and today's real balance), never by mutating
// the original opening-balance row — POST /api/accounts/[id] does this
// server-side; this form just sends the desired figure.
export default function GoalEditForm({
  goal,
  onSaved,
  onCancel,
}: {
  goal: GoalAccount;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('goals.edit');

  const [name, setName] = useState(goal.name);
  const [hasTarget, setHasTarget] = useState(goal.goalTarget !== null);
  const [goalTarget, setGoalTarget] = useState(goal.goalTarget !== null ? String(goal.goalTarget) : '');
  const [hasTargetDate, setHasTargetDate] = useState(goal.goalTargetDate !== null);
  const [goalTargetDate, setGoalTargetDate] = useState(goal.goalTargetDate ?? '');
  const [amountOwed, setAmountOwed] = useState(goal.isDebt ? String(Math.abs(goal.balance)) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          goalTarget: hasTarget ? parseFloat(goalTarget) : null,
          goalTargetDate: hasTargetDate ? goalTargetDate : null,
          ...(goal.isDebt ? { newAmountOwed: parseFloat(amountOwed) || 0 } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };
  const canSave = name.trim().length > 0 && (!hasTarget || parseFloat(goalTarget) >= 0);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('name')}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
      </div>

      {goal.isDebt && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('amountOwed')}</label>
          <input type="number" min="0" step="0.01" value={amountOwed} onChange={(e) => setAmountOwed(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
          <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>{t('amountOwedHint')}</p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#0F2044' }}>
            {goal.isDebt ? t('payoffTarget') : t('goalTarget')}
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#6B7280' }}>
            <input type="checkbox" checked={!hasTarget} onChange={(e) => setHasTarget(!e.target.checked)} />
            {t('noTargetCheckbox')}
          </label>
        </div>
        {hasTarget && (
          <input type="number" min="0" step="0.01" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#0F2044' }}>
            {goal.isDebt ? t('payoffDate') : t('goalTargetDate')}
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#6B7280' }}>
            <input type="checkbox" checked={!hasTargetDate} onChange={(e) => setHasTargetDate(!e.target.checked)} />
            {t('noDateCheckbox')}
          </label>
        </div>
        {hasTargetDate && (
          <input type="date" value={goalTargetDate} onChange={(e) => setGoalTargetDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
        )}
      </div>

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{ border: '1.5px solid #D1D5DB', color: '#6B7280', background: 'white' }}>
          {t('cancel')}
        </button>
        <button type="button" onClick={submit} disabled={!canSave || saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{ background: '#0F2044', color: 'white' }}>
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

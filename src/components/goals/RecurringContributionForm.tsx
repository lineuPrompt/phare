'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// Creates a recurring transfer targeting ONE fixed goal — the "Set up
// recurring contribution" flow on the Goals page. Destination is locked to
// this goal (unlike RecurringForm's general-purpose destination selector);
// source is always chequing, resolved server-side, same as a one-off
// transfer. Editing/deleting an existing rule lives on the Recurring page,
// which lists every recurring item including this one.
export default function RecurringContributionForm({
  goalId,
  goalName,
  onSaved,
  onCancel,
}: {
  goalId: string;
  goalName: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('goals.recurring');
  const today = new Date().toISOString().slice(0, 10);

  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<'monthly' | 'biweekly' | 'semimonthly' | 'weekly'>('monthly');
  const [anchorDate, setAnchorDate] = useState(today);
  const [secondDay, setSecondDay] = useState('30');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: goalName,
          amount: parseFloat(amount),
          type: 'transfer',
          cadence,
          anchorDate: anchorDate || null,
          secondDay: cadence === 'semimonthly' ? parseInt(secondDay, 10) : null,
          destinationAccountId: goalId,
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
  const canSave = parseFloat(amount) > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('amount')}</label>
          <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('cadence')}</label>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none bg-white" style={inputStyle}>
            <option value="monthly">{t('cadenceMonthly')}</option>
            <option value="biweekly">{t('cadenceBiweekly')}</option>
            <option value="semimonthly">{t('cadenceSemimonthly')}</option>
            <option value="weekly">{t('cadenceWeekly')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('firstDate')}</label>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
        </div>
        {cadence === 'semimonthly' && (
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#0F2044' }}>{t('secondDay')}</label>
            <input type="number" min="1" max="31" value={secondDay} onChange={(e) => setSecondDay(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
          </div>
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
          style={{ background: '#2ABFBF', color: 'white' }}>
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

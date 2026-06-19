'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecurringAccount, RecurringCategory } from './types';

export default function RecurringForm({
  accounts,
  categories,
  onSaved,
}: {
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  onSaved: () => void;
}) {
  const t = useTranslations('recurring.form');
  const today = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<'monthly' | 'biweekly' | 'semimonthly'>('monthly');
  const [anchorDate, setAnchorDate] = useState(today);
  const [secondDay, setSecondDay] = useState('30');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const resolvedAccountId = accountId || accounts[0]?.id;
    if (!resolvedAccountId) {
      setError('Add an account before saving a recurring item');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          amount: parseFloat(amount),
          type,
          cadence,
          anchorDate,
          secondDay: cadence === 'semimonthly' ? parseInt(secondDay, 10) : null,
          categoryId: categoryId || null,
          accountId: resolvedAccountId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setDescription('');
      setAmount('');
      setCategoryId('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };
  const canSave = description.trim() && parseFloat(amount) > 0 && accounts.length > 0;

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      {/* Income / Expense toggle */}
      <div className="flex gap-2 mb-4">
        {(['expense', 'income'] as const).map((tp) => (
          <button key={tp} onClick={() => setType(tp)}
            className="px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all"
            style={{
              border: type === tp ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
              background: type === tp ? '#F0FDFD' : 'white',
              color: type === tp ? '#0F2044' : '#6B7280',
            }}>
            {t(tp)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t('description')} className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={t('amount')} className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}
          className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white" style={inputStyle}>
          <option value="monthly">{t('monthly')}</option>
          <option value="biweekly">{t('biweekly')}</option>
          <option value="semimonthly">{t('semimonthly')}</option>
        </select>
        <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)}
          className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <select value={accountId || accounts[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}
          className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white" style={inputStyle}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        {/* Category — optional for expenses; hidden for income */}
        {type === 'expense' && categories.length > 0 && (
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white" style={inputStyle}>
            <option value="">{t('category')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {cadence === 'semimonthly' && (
        <div className="mb-4">
          <label className="text-sm" style={{ color: '#6B7280' }}>{t('secondDay')}</label>
          <input type="number" min="1" max="31" value={secondDay} onChange={(e) => setSecondDay(e.target.value)}
            className="ml-2 w-20 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <button onClick={submit} disabled={!canSave || saving}
        className="px-6 py-2.5 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
        style={{ background: '#0F2044' }}>
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  );
}

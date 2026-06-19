'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Account, ExpenseCategory } from './types';

export default function ExpenseForm({
  categories,
  accounts,
  onSaved,
  defaultDate,
  accountId,
}: {
  categories: ExpenseCategory[];
  accounts: Account[];
  onSaved: () => void;
  defaultDate?: string;
  accountId: string | null;
}) {
  const t = useTranslations('expenses.form');
  const today = new Date().toISOString().slice(0, 10);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [date, setDate] = useState(defaultDate ?? today);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState(accountId ?? '');
  const [amount, setAmount] = useState('');
  const [repeat, setRepeat] = useState<'once' | 'monthly' | 'installments'>('once');
  const [installments, setInstallments] = useState('2');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [localCategories, setLocalCategories] = useState(categories);

  useEffect(() => { setLocalCategories(categories); }, [categories]);
  useEffect(() => { setSelectedAccountId(accountId ?? ''); }, [accountId]);

  const switchType = (t: 'expense' | 'income') => {
    setEntryType(t);
    // Category is irrelevant for income — clear it to avoid stale state
    if (t === 'income') setCategoryId('');
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: entryType,
          date,
          description: description.trim(),
          categoryId: entryType === 'expense' ? categoryId : undefined,
          amount: parseFloat(amount),
          repeat,
          installments: repeat === 'installments' ? parseInt(installments, 10) : undefined,
          accountId: selectedAccountId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      setDescription('');
      setAmount('');
      setRepeat('once');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) return;
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName }),
    });
    if (res.ok) {
      const { category } = await res.json();
      setLocalCategories((prev) => [...prev, category]);
      setCategoryId(category.id);
      setNewCategoryMode(false);
      setNewCategoryName('');
    } else {
      setError((await res.json()).error || 'Failed to create category');
    }
  };

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };

  // Category required only for expenses; account required only when multiple accounts exist
  const canSave = description.trim() && parseFloat(amount) > 0
    && (entryType === 'income' || categoryId)
    && (accounts.length <= 1 || selectedAccountId);

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      {/* Money-in / Money-out toggle */}
      <div className="flex gap-2 mb-4">
        {(['expense', 'income'] as const).map((tp) => (
          <button key={tp} onClick={() => switchType(tp)}
            className="px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all"
            style={{
              border: entryType === tp ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
              background: entryType === tp ? '#F0FDFD' : 'white',
              color: entryType === tp ? '#0F2044' : '#6B7280',
            }}>
            {tp === 'expense' ? t('moneyOut') : t('moneyIn')}
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${
        entryType === 'expense'
          ? accounts.length > 1 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
          : accounts.length > 1 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
      } gap-3 mb-3`}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t('description')} className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />

        {/* Category — expenses only */}
        {entryType === 'expense' && (
          !newCategoryMode ? (
            <select value={categoryId}
              onChange={(e) => {
                if (e.target.value === '__new__') { setNewCategoryMode(true); setCategoryId(''); }
                else setCategoryId(e.target.value);
              }}
              className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white" style={inputStyle}>
              <option value="">{t('category')}</option>
              {localCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">{t('newCategory')}</option>
            </select>
          ) : (
            <div className="flex gap-2">
              <input type="text" value={newCategoryName} autoFocus
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t('newCategoryName')}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
              <button type="button" onClick={createCategory}
                className="px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer shrink-0"
                style={{ background: '#2ABFBF', color: '#0F2044' }}>✓</button>
              <button type="button" onClick={() => { setNewCategoryMode(false); setNewCategoryName(''); }}
                className="px-3 py-2.5 rounded-lg text-sm cursor-pointer shrink-0"
                style={{ border: '1.5px solid #D1D5DB', color: '#6B7280' }}>✕</button>
            </div>
          )
        )}

        {accounts.length > 1 && (
          <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}
            className="px-3 py-2.5 rounded-lg text-sm outline-none bg-white" style={inputStyle}>
            <option value="">{t('account')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.type === 'chequing' ? '🏦 ' : '💳 '}{a.name}
              </option>
            ))}
          </select>
        )}

        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={t('amount')} className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {(['once', 'monthly', 'installments'] as const).map((mode) => (
          <button key={mode} onClick={() => setRepeat(mode)}
            className="px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all"
            style={{
              border: repeat === mode ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
              background: repeat === mode ? '#F0FDFD' : 'white',
              color: repeat === mode ? '#0F2044' : '#6B7280',
            }}>
            {t(mode)}
          </button>
        ))}
        {repeat === 'installments' && (
          <input type="number" min="2" max="48" value={installments}
            onChange={(e) => setInstallments(e.target.value)}
            className="w-20 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <button onClick={submit} disabled={!canSave || saving}
        className="px-6 py-2.5 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
        style={{ background: entryType === 'income' ? '#16A34A' : '#0F2044' }}>
        {saving ? t('saving') : entryType === 'income' ? t('saveIncome') : t('save')}
      </button>
    </div>
  );
}

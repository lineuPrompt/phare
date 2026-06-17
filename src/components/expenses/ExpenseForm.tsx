'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ExpenseCategory } from './types';

export default function ExpenseForm({
  categories,
  onSaved,
  defaultDate,
  accountId,
}: {
  categories: ExpenseCategory[];
  onSaved: () => void;
  defaultDate?: string;
  accountId: string | null;
}) {
  const t = useTranslations('expenses.form');
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(defaultDate ?? today);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [repeat, setRepeat] = useState<'once' | 'monthly' | 'installments'>('once');
  const [installments, setInstallments] = useState('2');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [localCategories, setLocalCategories] = useState(categories);

  useEffect(() => { setLocalCategories(categories); }, [categories]);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim(),
          categoryId,
          amount: parseFloat(amount),
          repeat,
          installments: repeat === 'installments' ? parseInt(installments, 10) : undefined,
          accountId,
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
  const canSave = description.trim() && categoryId && parseFloat(amount) > 0;

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t('description')} className="px-3 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
        {!newCategoryMode ? (
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
        style={{ background: '#0F2044' }}>
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  );
}
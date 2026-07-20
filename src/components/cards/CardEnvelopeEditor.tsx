'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/expenses/types';
import { sumWarning } from '@/lib/envelopeHelpers';

type Category = { id: string; name: string };

type Item = { categoryId: string; categoryName: string; monthlyAmount: number };

export type CardEnvelopeEditorProps = {
  cardId: string;
  month: string;
  totalGoal: number | null;
  envelopeItems: { categoryId: string; categoryName: string; monthlyAmount: number }[];
  statementCloseDay: number | null;
  paymentDay: number | null;
  categories: Category[];
  locale: string;
  onSaved: () => void;
  onCancel: () => void;
};

export default function CardEnvelopeEditor({
  cardId,
  month,
  totalGoal: initialGoal,
  envelopeItems: initialItems,
  statementCloseDay: initialCloseDay,
  paymentDay: initialPayDay,
  categories,
  locale,
  onSaved,
  onCancel,
}: CardEnvelopeEditorProps) {
  const t = useTranslations('cards');
  const [goalStr, setGoalStr] = useState(initialGoal?.toString() ?? '');
  const [items, setItems] = useState<Item[]>(initialItems);
  const [closeDay, setCloseDay] = useState(initialCloseDay?.toString() ?? '');
  const [payDay, setPayDay]     = useState(initialPayDay?.toString()   ?? '');
  const [addCatId, setAddCatId] = useState('');
  const [saving, setSaving]     = useState(false);
  const [copying, setCopying]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Sync when parent data changes (e.g. card switch)
  useEffect(() => {
    setGoalStr(initialGoal?.toString() ?? '');
    setItems(initialItems);
    setCloseDay(initialCloseDay?.toString() ?? '');
    setPayDay(initialPayDay?.toString() ?? '');
  }, [cardId, initialGoal, initialItems, initialCloseDay, initialPayDay]);

  const goal = parseFloat(goalStr);
  const validGoal = !isNaN(goal) && goal >= 0;

  const overAllocated = validGoal && sumWarning(
    items.map((i) => ({ monthlyAmount: i.monthlyAmount })),
    goal
  );

  const allocatedSum = items.reduce((s, i) => s + i.monthlyAmount, 0);

  const usedIds = new Set(items.map((i) => i.categoryId));
  const available = categories.filter((c) => !usedIds.has(c.id));

  const addCategory = () => {
    if (!addCatId) return;
    const cat = categories.find((c) => c.id === addCatId);
    if (!cat) return;
    setItems((prev) => [...prev, { categoryId: cat.id, categoryName: cat.name, monthlyAmount: 0 }]);
    setAddCatId('');
  };

  const updateAmount = (categoryId: string, value: string) => {
    const amount = parseFloat(value) || 0;
    setItems((prev) => prev.map((i) => i.categoryId === categoryId ? { ...i, monthlyAmount: amount } : i));
  };

  const removeItem = (categoryId: string) => {
    setItems((prev) => prev.filter((i) => i.categoryId !== categoryId));
  };

  const save = async () => {
    if (!validGoal) { setError('Enter a valid monthly goal.'); return; }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/card-envelope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId,
        month,
        totalGoal: goal,
        items: items.map((i) => ({ categoryId: i.categoryId, monthlyAmount: i.monthlyAmount })),
        statementCloseDay: closeDay ? parseInt(closeDay, 10) : null,
        paymentDay:        payDay   ? parseInt(payDay, 10)   : null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.daysUpdateFailed) {
        // Goal + categories DID save — only the statement/payment day write
        // failed. Surface that explicitly rather than closing the editor as
        // if everything the user submitted was saved: a stale
        // statement_close_day/payment_day silently misdates the next bridge
        // payment computed for this card.
        setError(t('editor.daysUpdateFailed'));
        return;
      }
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'Failed to save.');
    }
  };

  // Explicit, one-shot copy into the local (unsaved) form state — nothing is
  // written until Save is pressed, and Save only ever writes the viewed
  // month, so copying into August and editing never touches July's rows.
  const copyFromPrevious = async () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    setCopying(true);
    setError(null);
    try {
      const res = await fetch(`/api/card-envelope?cardId=${cardId}&month=${prevMonth}`);
      if (!res.ok) throw new Error();
      const prev = await res.json();
      const prevItems: Item[] = (prev.envelopeItems ?? [])
        .filter((i: { monthlyAmount: number }) => i.monthlyAmount > 0)
        .map((i: { categoryId: string; categoryName: string; monthlyAmount: number }) => ({
          categoryId: i.categoryId, categoryName: i.categoryName, monthlyAmount: i.monthlyAmount,
        }));
      if (prev.totalGoal === null && prevItems.length === 0) {
        setError(t('editor.copyNothingToCopy'));
        return;
      }
      if (prev.totalGoal !== null) setGoalStr(String(prev.totalGoal));
      setItems(prevItems);
    } catch {
      setError(t('editor.copyFailed'));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-6 space-y-6" style={{ border: '2px solid #2ABFBF' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold" style={{ color: '#0F2044' }}>{t('editor.title')}</h3>
        <button
          onClick={copyFromPrevious}
          disabled={copying}
          className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-80 disabled:opacity-50"
          style={{ border: '1.5px solid #2ABFBF', color: '#2ABFBF' }}
        >
          {copying ? t('editor.copying') : t('editor.copyFromPrevious')}
        </button>
      </div>

      {/* Total goal */}
      <div className="space-y-1">
        <label className="text-sm font-medium" style={{ color: '#0F2044' }}>{t('editor.totalGoal')}</label>
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: '#6B7280' }}>$</span>
          <input
            type="number"
            min="0"
            step="1"
            value={goalStr}
            onChange={(e) => setGoalStr(e.target.value)}
            placeholder={t('editor.totalGoalPlaceholder')}
            className="w-40 px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
          />
        </div>
      </div>

      {/* Category allocations */}
      <div className="space-y-3">
        <p className="text-sm font-medium" style={{ color: '#0F2044' }}>{t('editor.categories')}</p>

        {items.map((item) => (
          <div key={item.categoryId} className="flex items-center gap-3">
            <span className="flex-1 text-sm" style={{ color: '#0F2044' }}>{item.categoryName}</span>
            <div className="flex items-center gap-1">
              <span className="text-sm" style={{ color: '#6B7280' }}>$</span>
              <input
                type="number"
                min="0"
                step="1"
                value={item.monthlyAmount || ''}
                onChange={(e) => updateAmount(item.categoryId, e.target.value)}
                className="w-28 px-3 py-1.5 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
              />
            </div>
            <button
              onClick={() => removeItem(item.categoryId)}
              className="text-xs cursor-pointer hover:opacity-70"
              style={{ color: '#DC2626' }}
            >
              {t('editor.removeCategory')}
            </button>
          </div>
        ))}

        {/* Add category row */}
        {available.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <select
              value={addCatId}
              onChange={(e) => setAddCatId(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: addCatId ? '#0F2044' : '#9CA3AF' }}
            >
              <option value="">{t('editor.addCategory')}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={addCategory}
              disabled={!addCatId}
              className="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-40 hover:opacity-80"
              style={{ background: '#0F2044', color: 'white' }}
            >
              +
            </button>
          </div>
        )}

        {/* Allocated total + sum warning */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs" style={{ color: '#6B7280' }}>
            Allocated: {formatCurrency(allocatedSum, locale)}
            {validGoal && ` / ${formatCurrency(goal, locale)}`}
          </span>
          {overAllocated && (
            <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: '#FEF3C7', color: '#D97706' }}>
              {t('editor.sumWarning', {
                sum: formatCurrency(allocatedSum, locale),
                goal: formatCurrency(goal, locale),
              })}
            </span>
          )}
        </div>
      </div>

      {/* Statement days */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: '#0F2044' }}>{t('editor.statementCloseDay')}</label>
          <input
            type="number"
            min="1"
            max="31"
            value={closeDay}
            onChange={(e) => setCloseDay(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: '#0F2044' }}>{t('editor.paymentDay')}</label>
          <input
            type="number"
            min="1"
            max="31"
            value={payDay}
            onChange={(e) => setPayDay(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
          />
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving || !validGoal}
          className="px-5 py-2 rounded-full text-sm font-medium cursor-pointer hover:opacity-90 disabled:opacity-50"
          style={{ background: '#0F2044', color: 'white' }}
        >
          {saving ? t('editor.saving') : t('editor.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-full text-sm cursor-pointer hover:opacity-70"
          style={{ color: '#6B7280', border: '1.5px solid #D1D5DB' }}
        >
          {t('editor.cancel')}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecurringItem, RecurringAccount, RecurringCategory, formatCurrency } from './types';

export default function RecurringList({
  items,
  accounts,
  categories,
  locale,
  onChanged,
}: {
  items: RecurringItem[];
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations('recurring.list');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCadence, setEditCadence] = useState<'monthly' | 'biweekly' | 'semimonthly'>('monthly');
  const [editAnchorDate, setEditAnchorDate] = useState('');
  const [editSecondDay, setEditSecondDay] = useState('30');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (item: RecurringItem) => {
    setEditingId(item.id);
    setEditDesc(item.description);
    setEditAmount(String(item.amount));
    setEditCadence(item.cadence);
    setEditAnchorDate(item.anchor_date);
    setEditSecondDay(String(item.second_day ?? 30));
    setEditCategoryId(item.category_id ?? '');
    setEditAccountId(item.account_id);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/recurring/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editDesc.trim(),
          amount: parseFloat(editAmount),
          cadence: editCadence,
          anchorDate: editAnchorDate,
          secondDay: editCadence === 'semimonthly' ? parseInt(editSecondDay, 10) : null,
          categoryId: editCategoryId || null,
          accountId: editAccountId,
        }),
      });
      if (!res.ok) {
        console.error('Failed to update recurring item:', await res.json().catch(() => null));
        return;
      }
      setEditingId(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (id: string) => {
    await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
    setConfirmId(null);
    onChanged();
  };

  const cadenceLabel = (c: string) => t(`cadence.${c}`);

  const inputStyle = { border: '1px solid #D1D5DB', color: '#0F2044' };
  const canSaveEdit = editDesc.trim().length > 0 && parseFloat(editAmount) > 0 && editAccountId;

  if (!items.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
        <p style={{ color: '#6B7280' }}>{t('empty')}</p>
      </div>
    );
  }

  const income = items.filter((i) => i.type === 'income');
  const expense = items.filter((i) => i.type === 'expense');

  const Row = ({ item }: { item: RecurringItem }) => {
    const isEditing = editingId === item.id;

    if (isEditing) {
      return (
        <div className="py-3 px-2 rounded-lg space-y-3" style={{ background: '#F0FDFD', marginBottom: '4px' }}>
          {/* Row 1: description + amount */}
          <div className="flex flex-wrap gap-2">
            <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
              className="flex-1 min-w-[140px] px-2 py-1.5 rounded text-sm outline-none" style={inputStyle} />
            <input type="number" step="0.01" min="0" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
              className="w-28 px-2 py-1.5 rounded text-sm outline-none" style={inputStyle} />
          </div>
          {/* Row 2: cadence + anchor date */}
          <div className="flex flex-wrap gap-2">
            <select value={editCadence}
              onChange={(e) => setEditCadence(e.target.value as typeof editCadence)}
              className="px-2 py-1.5 rounded text-sm outline-none bg-white" style={inputStyle}>
              <option value="monthly">{t('cadence.monthly')}</option>
              <option value="biweekly">{t('cadence.biweekly')}</option>
              <option value="semimonthly">{t('cadence.semimonthly')}</option>
            </select>
            <input type="date" value={editAnchorDate} onChange={(e) => setEditAnchorDate(e.target.value)}
              className="px-2 py-1.5 rounded text-sm outline-none" style={inputStyle} />
            {editCadence === 'semimonthly' && (
              <input type="number" min="1" max="31" value={editSecondDay}
                onChange={(e) => setEditSecondDay(e.target.value)}
                className="w-20 px-2 py-1.5 rounded text-sm outline-none" style={inputStyle}
                title={t('secondDay')} />
            )}
          </div>
          {/* Row 3: account + category */}
          <div className="flex flex-wrap gap-2">
            <select value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)}
              className="px-2 py-1.5 rounded text-sm outline-none bg-white" style={inputStyle}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.type === 'chequing' ? '🏦' : '💳'} {a.name}</option>
              ))}
            </select>
            {/* Category — only shown for expense items */}
            {item.type === 'expense' && categories.length > 0 && (
              <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}
                className="px-2 py-1.5 rounded text-sm outline-none bg-white" style={inputStyle}>
                <option value="">{t('noCategory')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <div className="flex gap-1 ml-auto">
              <button onClick={() => saveEdit(item.id)} disabled={!canSaveEdit || saving}
                className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-40"
                style={{ background: '#0F2044' }}>
                {saving ? '…' : t('save')}
              </button>
              <button onClick={cancelEdit}
                className="px-3 py-1.5 rounded text-sm cursor-pointer" style={{ color: '#6B7280' }}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3 py-3 px-2 group" style={{ borderBottom: '1px solid #F3F4F6' }}>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" style={{ color: '#0F2044' }}>{item.description}</p>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            {cadenceLabel(item.cadence)}
            {item.categories?.name ? ` · ${item.categories.name}` : ''}
            {item.accounts?.name ? ` · ${item.accounts.type === 'chequing' ? '🏦' : '💳'} ${item.accounts.name}` : ''}
          </p>
        </div>
        <span className="font-bold shrink-0 w-24 text-right" style={{ color: item.type === 'income' ? '#16A34A' : '#0F2044' }}>
          {item.type === 'income' ? '+' : ''}{formatCurrency(Number(item.amount), locale)}
        </span>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => startEdit(item)}
            className="px-2 py-1 rounded text-xs cursor-pointer" style={{ color: '#2ABFBF' }}>
            {t('edit')}
          </button>
          <button onClick={() => setConfirmId(item.id)}
            className="px-2 py-1 rounded text-xs cursor-pointer" style={{ color: '#DC2626' }}>
            {t('delete')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {income.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#16A34A' }}>{t('incomeTitle')}</h3>
          {income.map((i) => <Row key={i.id} item={i} />)}
        </div>
      )}

      {expense.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#6B7280' }}>{t('expenseTitle')}</h3>
          {expense.map((i) => <Row key={i.id} item={i} />)}
        </div>
      )}

      {confirmId && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{t('confirmBody')}</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => doDelete(confirmId)}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer" style={{ background: '#DC2626' }}>
                {t('confirmDelete')}
              </button>
              <button onClick={() => setConfirmId(null)}
                className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer" style={{ color: '#6B7280' }}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

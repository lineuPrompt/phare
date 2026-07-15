'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Expense, ExpenseCategory, Account, formatSignedAmount } from './types';

export default function ExpenseList({
  expenses,
  categories,
  accounts,
  locale,
  onChanged,
}: {
  expenses: Expense[];
  categories: ExpenseCategory[];
  accounts: Account[];
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations('expenses.list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCat, setEditCat] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editAccount, setEditAccount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setEditDate(e.date);
    setEditDesc(e.description);
    setEditCat(e.category_id ?? '');
    setEditAmount(String(e.amount));
    setEditAccount(e.account_id ?? '');
  };

  const saveEdit = async (id: string) => {
    const response = await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate,
        description: editDesc,
        categoryId: editCat || null,
        amount: parseFloat(editAmount),
        accountId: editAccount || null,
      }),
    });
    if (!response.ok) {
      console.error('Failed to update expense:', await response.json().catch(() => null));
      return;
    }
    setEditingId(null);
    onChanged();
  };

  const doDelete = async (id: string, series: boolean) => {
    await fetch(`/api/expenses/${id}${series ? '?series=true' : ''}`, { method: 'DELETE' });
    setConfirmDelete(null);
    onChanged();
  };

  if (!expenses.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
        <p style={{ color: '#6B7280' }}>{t('empty')}</p>
      </div>
    );
  }

  const fmtDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short',
    });

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      <div className="space-y-1">
        {expenses.map((e) => {
          const isEditing = editingId === e.id;
          const isBridge = e.is_bridge === true;
          const canSaveEdit = editDesc.trim().length > 0 && parseFloat(editAmount) > 0 && (isBridge || editCat.length > 0);

          if (isEditing) {
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-2 px-2 rounded-lg" style={{ background: '#F0FDFD' }}>
                <input type="date" value={editDate} onChange={(ev) => setEditDate(ev.target.value)}
                  className="px-2 py-1.5 rounded text-sm outline-none" style={{ border: '1px solid #D1D5DB', color: '#0F2044' }} />
                <input type="text" value={editDesc} onChange={(ev) => setEditDesc(ev.target.value)}
                  className="flex-1 min-w-[120px] px-2 py-1.5 rounded text-sm outline-none" style={{ border: '1px solid #D1D5DB', color: '#0F2044' }} />
                {/* Category selector: hidden for bridge lines (deliberately uncategorized) */}
                {!isBridge && (
                  <select value={editCat} onChange={(ev) => setEditCat(ev.target.value)}
                    className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                    style={{ border: editCat ? '1px solid #D1D5DB' : '1.5px solid #DC2626', color: '#0F2044' }}>
                    <option value="">{t('pickCategory')}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <select value={editAccount} onChange={(ev) => setEditAccount(ev.target.value)}
                  className="px-2 py-1.5 rounded text-sm outline-none bg-white" style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.type === 'chequing' ? '🏦' : '💳'} {a.name}</option>
                  ))}
                </select>
                <input type="number" step="0.01" value={editAmount} onChange={(ev) => setEditAmount(ev.target.value)}
                  className="w-24 px-2 py-1.5 rounded text-sm outline-none" style={{ border: '1px solid #D1D5DB', color: '#0F2044' }} />
                <button onClick={() => saveEdit(e.id)} disabled={!canSaveEdit}
                  className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-40"
                  style={{ background: '#0F2044' }}>✓</button>
                <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded text-sm cursor-pointer" style={{ color: '#6B7280' }}>✕</button>
              </div>
            );
          }
          return (
            <div key={e.id} className="flex items-center gap-3 py-2.5 px-2 group" style={{ borderBottom: '1px solid #F3F4F6' }}>
              <span className="text-sm w-14 shrink-0" style={{ color: '#6B7280' }}>{fmtDate(e.date)}</span>
              <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#0F2044' }}>
                {e.description}
                {e.installment_label && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>
                    {e.installment_label}
                  </span>
                )}
              </span>
              <span className="text-xs shrink-0" style={{ color: '#9CA3AF' }}>{e.categories?.name ?? ''}</span>
              <span className="text-sm font-medium w-24 text-right shrink-0" style={{ color: formatSignedAmount(Number(e.amount), e.type, locale).color }}>
                {formatSignedAmount(Number(e.amount), e.type, locale).text}
              </span>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(e)} className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#2ABFBF' }}>{t('edit')}</button>
                <button onClick={() => setConfirmDelete(e)} className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#DC2626' }}>{t('delete')}</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{confirmDelete.description}</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => doDelete(confirmDelete.id, false)}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer" style={{ background: '#DC2626' }}>
                {t('deleteOne')}
              </button>
              {confirmDelete.recurrence_id && (
                <button onClick={() => doDelete(confirmDelete.id, true)}
                  className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer" style={{ border: '1.5px solid #DC2626', color: '#DC2626' }}>
                  {t('deleteSeries')}
                </button>
              )}
              <button onClick={() => setConfirmDelete(null)}
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

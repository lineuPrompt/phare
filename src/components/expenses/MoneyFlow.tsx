'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Expense, Account, formatCurrency, formatSignedAmount } from './types';

export default function MoneyFlow({
  income,
  totalIncome,
  totalSpent,
  net,
  locale,
  accounts,
  onChanged,
}: {
  income: Expense[];
  totalIncome: number;
  totalSpent: number;
  net: number;
  locale: string;
  accounts: Account[];
  onChanged: () => void;
}) {
  const t = useTranslations('expenses.flow');
  const positive = net >= 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editAccount, setEditAccount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setEditDate(e.date);
    setEditDesc(e.description);
    setEditAmount(String(e.amount));
    setEditAccount(e.account_id ?? '');
  };

  const saveEdit = async (id: string) => {
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate,
        description: editDesc,
        categoryId: null,
        amount: parseFloat(editAmount),
        accountId: editAccount || null,
      }),
    });
    if (!res.ok) {
      console.error('Failed to update income:', await res.json().catch(() => null));
      return;
    }
    setEditingId(null);
    onChanged();
  };

  const doDelete = async (id: string) => {
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    onChanged();
  };

  const canSave = editDesc.trim().length > 0 && parseFloat(editAmount) > 0;

  const fmtDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short',
    });

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      {/* Totals row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl p-4" style={{ background: '#F0FDF4' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('in')}</p>
          <p className="text-xl font-bold" style={{ color: '#16A34A' }}>{formatCurrency(totalIncome, locale)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('out')}</p>
          <p className="text-xl font-bold" style={{ color: '#DC2626' }}>{formatCurrency(totalSpent, locale)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: positive ? '#F0FDFD' : '#FEF2F2' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('net')}</p>
          <p className="text-xl font-bold" style={{ color: positive ? '#16A34A' : '#DC2626' }}>
            {formatCurrency(net, locale)}
          </p>
        </div>
      </div>

      {/* Income rows */}
      {income.length > 0 && (
        <div className="space-y-1">
          {income.map((i) => {
            const isEditing = editingId === i.id;

            if (isEditing) {
              return (
                <div key={i.id} className="flex flex-wrap items-center gap-2 py-2 px-2 rounded-lg" style={{ background: '#F0FDF4' }}>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(ev) => setEditDate(ev.target.value)}
                    className="px-2 py-1.5 rounded text-sm outline-none"
                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                  />
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(ev) => setEditDesc(ev.target.value)}
                    className="flex-1 min-w-[120px] px-2 py-1.5 rounded text-sm outline-none"
                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                  />
                  {accounts.length > 1 && (
                    <select
                      value={editAccount}
                      onChange={(ev) => setEditAccount(ev.target.value)}
                      className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                      style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.type === 'chequing' ? '🏦' : '💳'} {a.name}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(ev) => setEditAmount(ev.target.value)}
                    className="w-24 px-2 py-1.5 rounded text-sm outline-none"
                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                  />
                  <button
                    onClick={() => saveEdit(i.id)}
                    disabled={!canSave}
                    className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-40"
                    style={{ background: '#16A34A' }}
                  >✓</button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 rounded text-sm cursor-pointer"
                    style={{ color: '#6B7280' }}
                  >✕</button>
                </div>
              );
            }

            return (
              <div key={i.id} className="flex items-center gap-3 py-1.5 px-2 group" style={{ borderBottom: '1px solid #F9FAFB' }}>
                <span className="text-sm w-14 shrink-0" style={{ color: '#6B7280' }}>{fmtDate(i.date)}</span>
                <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#0F2044' }}>{i.description}</span>
                <span className="text-sm font-medium shrink-0" style={{ color: formatSignedAmount(Number(i.amount), i.type, locale).color }}>
                  {formatSignedAmount(Number(i.amount), i.type, locale).text}
                </span>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(i)}
                    className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#2ABFBF' }}
                  >{t('edit')}</button>
                  <button
                    onClick={() => setConfirmDelete(i)}
                    className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#DC2626' }}
                  >{t('delete')}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{confirmDelete.description}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => doDelete(confirmDelete.id)}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer"
                style={{ background: '#DC2626' }}
              >{t('confirmDelete')}</button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer"
                style={{ color: '#6B7280' }}
              >{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

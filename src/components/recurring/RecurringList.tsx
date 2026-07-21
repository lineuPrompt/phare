'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecurringItem, RecurringAccount, RecurringCategory, RecurringGoalAccount, formatCurrency } from './types';
import { formatSignedAmount } from '@/components/expenses/types';
import { monthlyEquivalent } from '@/lib/incomeHelpers';
import { nextOccurrence } from '@/lib/dateHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

// ── RecurringRow ───────────────────────────────────────────────────────────
//
// This is a NAMED component defined at MODULE level (not inside RecurringList).
// That one rule prevents the focus-loss bug: when the user types in an amount
// field, only RecurringRow re-renders — not the parent — so React never tears
// down and recreates the DOM node, and focus is preserved.
//
// If Row were a function inside RecurringList (the previous implementation),
// every keystroke would cause RecurringList to re-render, redefine Row as a
// new function reference, and React would unmount/remount the entire row,
// destroying focus. Keeping Row here ensures its identity is stable.

type RecurringRowProps = {
  item: RecurringItem;
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  goalAccounts: RecurringGoalAccount[];
  locale: string;
  onChanged: () => void;
};

function RecurringRow({ item, accounts, categories, goalAccounts, locale, onChanged }: RecurringRowProps) {
  const t = useTranslations('recurring.list');
  const isTransfer = item.type === 'transfer';

  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state — initialised when user clicks Edit
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCadence, setEditCadence] = useState<'monthly' | 'biweekly' | 'semimonthly' | 'weekly'>('monthly');
  const [editAnchorDate, setEditAnchorDate] = useState('');
  const [editSecondDay, setEditSecondDay] = useState('30');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editDestinationId, setEditDestinationId] = useState('');

  const inputStyle = { border: '1px solid #D1D5DB', color: '#0F2044' };

  const startEdit = () => {
    setEditDesc(item.description);
    setEditAmount(String(item.amount));
    setEditCadence(item.cadence);
    setEditAnchorDate(item.anchor_date ?? '');
    setEditSecondDay(String(item.second_day ?? 30));
    setEditCategoryId(item.category_id ?? '');
    setEditAccountId(item.account_id);
    setEditDestinationId(item.destination_account_id ?? '');
    setIsEditing(true);
  };

  const cancelEdit = () => setIsEditing(false);

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/recurring/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editDesc.trim(),
          amount: parseFloat(editAmount),
          cadence: editCadence,
          anchorDate: editAnchorDate || null,
          secondDay: editCadence === 'semimonthly' ? parseInt(editSecondDay, 10) : null,
          categoryId: editCategoryId || null,
          accountId: editAccountId,
          destinationAccountId: editDestinationId || null,
        }),
      });
      if (!res.ok) {
        console.error('Failed to update recurring item:', await res.json().catch(() => null));
        return;
      }
      setIsEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    await fetch(`/api/recurring/${item.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    onChanged();
  };

  const canSaveEdit =
    editDesc.trim().length > 0 &&
    parseFloat(editAmount) > 0 &&
    (isTransfer ? !!editDestinationId : !!editAccountId && (item.type === 'income' || editCategoryId));

  if (isEditing) {
    return (
      <div className="py-3 px-2 rounded-lg space-y-3" style={{ background: '#F0FDFD', marginBottom: '4px' }}>
        {/* Row 1: description + amount */}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className="flex-1 min-w-[140px] px-2 py-1.5 rounded text-sm outline-none"
            style={inputStyle}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            className="w-28 px-2 py-1.5 rounded text-sm outline-none"
            style={inputStyle}
          />
        </div>
        {/* Row 2: cadence + anchor date */}
        <div className="flex flex-wrap gap-2">
          <select
            value={editCadence}
            onChange={(e) => setEditCadence(e.target.value as typeof editCadence)}
            className="px-2 py-1.5 rounded text-sm outline-none bg-white"
            style={inputStyle}
          >
            <option value="monthly">{t('cadence.monthly')}</option>
            <option value="biweekly">{t('cadence.biweekly')}</option>
            <option value="semimonthly">{t('cadence.semimonthly')}</option>
            <option value="weekly">{t('cadence.weekly')}</option>
          </select>
          <input
            type="date"
            value={editAnchorDate}
            onChange={(e) => setEditAnchorDate(e.target.value)}
            className="px-2 py-1.5 rounded text-sm outline-none"
            style={inputStyle}
          />
          {editCadence === 'semimonthly' && (
            <input
              type="number"
              min="1"
              max="31"
              value={editSecondDay}
              onChange={(e) => setEditSecondDay(e.target.value)}
              className="w-20 px-2 py-1.5 rounded text-sm outline-none"
              style={inputStyle}
              title={t('secondDay')}
            />
          )}
        </div>
        {/* Row 3: transfer → destination goal; income/expense → account + category */}
        <div className="flex flex-wrap gap-2">
          {isTransfer ? (
            <select
              value={editDestinationId}
              onChange={(e) => setEditDestinationId(e.target.value)}
              className="px-2 py-1.5 rounded text-sm outline-none bg-white"
              style={inputStyle}
            >
              {goalAccounts.map((g) => (
                <option key={g.id} value={g.id}>🎯 {g.name}</option>
              ))}
            </select>
          ) : (
            <>
              <select
                value={editAccountId}
                onChange={(e) => setEditAccountId(e.target.value)}
                className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                style={inputStyle}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === 'chequing' ? '🏦' : '💳'} {a.name}
                  </option>
                ))}
              </select>
              {item.type === 'expense' && categories.length > 0 && (
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                  style={inputStyle}
                >
                  <option value="">{t('noCategory')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </>
          )}
          <div className="flex gap-1 ml-auto">
            <button
              onClick={saveEdit}
              disabled={!canSaveEdit || saving}
              className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-40"
              style={{ background: '#0F2044' }}
            >
              {saving ? '…' : t('save')}
            </button>
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 rounded text-sm cursor-pointer"
              style={{ color: '#6B7280' }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex items-center gap-3 py-3 px-2 group"
        style={{ borderBottom: '1px solid #F3F4F6' }}
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" style={{ color: '#0F2044' }}>
            {item.description}
            {item.household_members?.name
              ? ` — ${item.household_members.name}`
              // No member row to join means household-level. For income this
              // is worth naming explicitly — it distinguishes "assigned to
              // the household on purpose" from a named person. For expenses,
              // household-level is the default absent any per-expense member
              // concept at all, so a bare description with no suffix already
              // reads as "ours" — adding a label there would be noise.
              : item.type === 'income' ? ` — ${t('householdLabel')}` : ''}
          </p>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            {t(`cadence.${item.cadence}`)}
            {item.cadence !== 'monthly' && (
              <>
                {' ('}
                {t(item.type === 'income' ? 'perPaycheque' : 'perPayment', { amount: formatCurrency(Number(item.amount), locale) })}
                {') '}
                {/* The monthly equivalent survives only as this labeled caption
                    — never shown as if it were a real month's number. */}
                {t('average', { amount: formatCurrency(monthlyEquivalent(Number(item.amount), item.cadence), locale) })}
              </>
            )}
            {item.categories?.name ? ` · ${item.categories.name}` : ''}
            {item.accounts?.name ? ` · ${item.accounts.type === 'chequing' ? '🏦' : '💳'} ${item.accounts.name}` : ''}
            {isTransfer && item.destination_accounts?.name ? ` · → 🎯 ${item.destination_accounts.name}` : ''}
            {!item.anchor_date ? ` · ⚠ ${t('needsPayDate')}` : ''}
          </p>
        </div>
        <span
          className="font-bold shrink-0 w-20 sm:w-24 text-right text-sm sm:text-base"
          style={{ color: formatSignedAmount(Number(item.amount), item.type, locale).color }}
        >
          {formatSignedAmount(Number(item.amount), item.type, locale).text}
        </span>
        <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button
            onClick={startEdit}
            className="px-2 py-1 rounded text-xs cursor-pointer"
            style={{ color: '#2ABFBF' }}
          >
            {t('edit')}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-2 py-1 rounded text-xs cursor-pointer"
            style={{ color: '#DC2626' }}
          >
            {t('delete')}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(15,32,68,0.4)' }}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full"
            style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}
          >
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>{t('confirmBody')}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={doDelete}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer"
                style={{ background: '#DC2626' }}
              >
                {t('confirmDelete')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer"
                style={{ color: '#6B7280' }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── RecurringList ──────────────────────────────────────────────────────────

export default function RecurringList({
  items,
  accounts,
  categories,
  goalAccounts,
  locale,
  onChanged,
}: {
  items: RecurringItem[];
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  goalAccounts: RecurringGoalAccount[];
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations('recurring.list');
  const { today } = useBusinessToday();

  if (!items.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
        <p style={{ color: '#6B7280' }}>{t('empty')}</p>
      </div>
    );
  }

  // Soonest-first within each group; items with no known pay date yet
  // (needsPayDate) have no computable next occurrence and sort last rather
  // than being fabricated a fake date.
  const byNextOccurrence = (a: RecurringItem, b: RecurringItem) => {
    const na = nextOccurrence({ cadence: a.cadence, anchorDate: a.anchor_date, secondDay: a.second_day }, today);
    const nb = nextOccurrence({ cadence: b.cadence, anchorDate: b.anchor_date, secondDay: b.second_day }, today);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return na.localeCompare(nb);
  };

  const income = items.filter((i) => i.type === 'income').sort(byNextOccurrence);
  const expense = items.filter((i) => i.type === 'expense').sort(byNextOccurrence);
  const transfer = items.filter((i) => i.type === 'transfer').sort(byNextOccurrence);

  return (
    <div className="space-y-6">
      {income.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#16A34A' }}>
            {t('incomeTitle')}
          </h3>
          {income.map((i) => (
            <RecurringRow
              key={i.id}
              item={i}
              accounts={accounts}
              categories={categories}
              goalAccounts={goalAccounts}
              locale={locale}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {expense.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#6B7280' }}>
            {t('expenseTitle')}
          </h3>
          {expense.map((i) => (
            <RecurringRow
              key={i.id}
              item={i}
              accounts={accounts}
              categories={categories}
              goalAccounts={goalAccounts}
              locale={locale}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {transfer.length > 0 && (
        <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-sm font-bold mb-3 uppercase tracking-wide" style={{ color: '#2ABFBF' }}>
            {t('transferTitle')}
          </h3>
          {transfer.map((i) => (
            <RecurringRow
              key={i.id}
              item={i}
              accounts={accounts}
              categories={categories}
              goalAccounts={goalAccounts}
              locale={locale}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

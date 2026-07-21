'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { RefObject } from 'react';
import type { MonthView } from '@/lib/timelineDisplayHelpers';
import type { TimelineEntry, TimelineTx } from '@/lib/timelineHelpers';
import type { ExpenseCategory } from '@/components/expenses/types';
import { formatCurrency, formatSignedAmount } from '@/components/expenses/types';

function fmtDay(iso: string, locale: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function sourceHref(
  entry: {
    isBridge: boolean;
    recurringItemId: string | null;
    transferPeerId: string | null;
    bridgeSourceAccount: string | null;
    bridgeSourceMonth: string | null;
  },
  locale: string
): string {
  // A bridge row is computed from a card's statement-cycle entries — it's
  // never edited directly (Part A4). It links straight to that card's
  // entries for the month that fed the bridge total, not just the Cards
  // page generically, so the "edit the cause, not the bridge" affordance is
  // one click, not a manual card+month hunt.
  if (entry.isBridge) {
    const params = new URLSearchParams();
    if (entry.bridgeSourceAccount) params.set('card', entry.bridgeSourceAccount);
    if (entry.bridgeSourceMonth) params.set('month', entry.bridgeSourceMonth);
    const qs = params.toString();
    return `/${locale}/cards${qs ? `?${qs}` : ''}`;
  }
  if (entry.recurringItemId) return `/${locale}/recurring`;
  if (entry.transferPeerId) return `/${locale}/goals`;
  // One-off entries have no editable home post-consolidation (Expenses is
  // retired; Timeline's own ledger is read-only) — Audit is where they can
  // still be traced.
  return `/${locale}/reconcile`;
}

// Inline edit/delete for a transfer entry (contribution or debt payment) —
// PATCH/DELETE /api/transfers/[id] already updates/removes BOTH peer rows
// (chequing-side + goal-side) atomically in one statement (resolvePair finds
// the pair by id or by transfer_peer_id, then operates on every matched id
// together) — reused as-is, no new endpoint needed. Also doubles as edit/
// delete for a single materialized occurrence of a recurring contribution or
// debt-payment rule (Part A3): when the target row still carries a
// recurring_item_id, the route detaches it server-side (tombstones the
// original date, clears recurring_item_id on both pair rows) before applying
// the edit or delete — a later edit to the RULE itself can no longer
// regenerate that date and silently revert or resurrect it.
function TransferControls({ entry, locale, onChanged }: { entry: TimelineTx; locale: string; onChanged: () => void }) {
  const t = useTranslations('timeline.list');
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [description, setDescription] = useState(entry.description ?? '');
  const [amount, setAmount] = useState(String(entry.amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/transfers/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amount), date, description: description.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setIsEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transfers/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSaving(false);
    }
  };

  const isRecurringOccurrence = entry.recurringItemId !== null;

  if (isEditing) {
    return (
      <div className="w-full flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg" style={{ background: '#F0FDFD' }}>
        <div className="w-full flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-24 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <button onClick={save} disabled={saving} className="text-xs font-semibold px-2 py-1 rounded cursor-pointer disabled:opacity-50" style={{ background: '#2ABFBF', color: '#0F2044' }}>
            {saving ? t('saving') : t('save')}
          </button>
          <button onClick={() => setIsEditing(false)} className="text-xs px-2 py-1 rounded cursor-pointer" style={{ color: '#6B7280' }}>
            {t('cancel')}
          </button>
        </div>
        {isRecurringOccurrence && (
          <p className="w-full text-xs" style={{ color: '#6B7280' }}>{t('detachHint')}</p>
        )}
        {error && <p className="w-full text-xs" style={{ color: '#DC2626' }}>{error}</p>}
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs" style={{ color: '#DC2626' }}>
          {isRecurringOccurrence ? t('confirmDeleteOccurrence') : t('confirmDelete')}
        </span>
        <button onClick={remove} disabled={saving} className="text-xs font-semibold cursor-pointer disabled:opacity-50" style={{ color: '#DC2626' }}>{t('delete')}</button>
        <button onClick={() => setConfirmDelete(false)} className="text-xs cursor-pointer" style={{ color: '#6B7280' }}>{t('cancel')}</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={() => setIsEditing(true)} className="text-xs cursor-pointer" style={{ color: '#2ABFBF' }}>{t('edit')}</button>
      <button onClick={() => setConfirmDelete(true)} className="text-xs cursor-pointer" style={{ color: '#DC2626' }}>{t('delete')}</button>
    </div>
  );
}

// Inline edit/delete for a plain manual entry (money in/out) AND for a
// single materialized recurring occurrence (Part A1 + A3). Both go through
// PATCH/DELETE /api/expenses/[id] — when the target row still carries a
// recurring_item_id, that endpoint detaches it from the rule server-side
// (tombstones the original date so a later rule edit can't regenerate it,
// then clears recurring_item_id) before applying the edit, or before
// deleting. The rule itself is never touched by either action.
function EntryControls({
  entry, locale, categories, onChanged,
}: {
  entry: TimelineTx;
  locale: string;
  categories: ExpenseCategory[];
  onChanged: () => void;
}) {
  const t = useTranslations('timeline.list');
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [description, setDescription] = useState(entry.description ?? '');
  const [amount, setAmount] = useState(String(entry.amount));
  const [type, setType] = useState<'income' | 'expense'>(entry.type === 'income' ? 'income' : 'expense');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isRecurringOccurrence = entry.recurringItemId !== null;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/expenses/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim() || null,
          amount: parseFloat(amount),
          type,
          // The category selector defaults to "unchanged," not "cleared" —
          // only send categoryId when the user actually picked one, so
          // saving an amount-only edit never wipes the entry's existing
          // category out from under it.
          categoryId: type === 'expense' && categoryId ? categoryId : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setIsEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="w-full flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg" style={{ background: '#F0FDFD' }}>
        <div className="w-full flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <select value={type} onChange={(e) => setType(e.target.value as 'income' | 'expense')}
            className="px-2 py-1 rounded text-xs outline-none bg-white" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}>
            <option value="expense">{t('moneyOut')}</option>
            <option value="income">{t('moneyIn')}</option>
          </select>
          {type === 'expense' && (
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="px-2 py-1 rounded text-xs outline-none bg-white" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}>
              <option value="">{t('categoryUnchanged')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-24 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
          <button onClick={save} disabled={saving} className="text-xs font-semibold px-2 py-1 rounded cursor-pointer disabled:opacity-50" style={{ background: '#2ABFBF', color: '#0F2044' }}>
            {saving ? t('saving') : t('save')}
          </button>
          <button onClick={() => setIsEditing(false)} className="text-xs px-2 py-1 rounded cursor-pointer" style={{ color: '#6B7280' }}>
            {t('cancel')}
          </button>
        </div>
        {isRecurringOccurrence && (
          <p className="w-full text-xs" style={{ color: '#6B7280' }}>{t('detachHint')}</p>
        )}
        {error && <p className="w-full text-xs" style={{ color: '#DC2626' }}>{error}</p>}
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs" style={{ color: '#DC2626' }}>
          {isRecurringOccurrence ? t('confirmDeleteOccurrence') : t('confirmDeleteEntry')}
        </span>
        <button onClick={remove} disabled={saving} className="text-xs font-semibold cursor-pointer disabled:opacity-50" style={{ color: '#DC2626' }}>{t('delete')}</button>
        <button onClick={() => setConfirmDelete(false)} className="text-xs cursor-pointer" style={{ color: '#6B7280' }}>{t('cancel')}</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={() => setIsEditing(true)} className="text-xs cursor-pointer" style={{ color: '#2ABFBF' }}>{t('edit')}</button>
      <button onClick={() => setConfirmDelete(true)} className="text-xs cursor-pointer" style={{ color: '#DC2626' }}>{t('delete')}</button>
    </div>
  );
}

function EntryRow({
  entry, locale, muted, categories, onChanged,
}: {
  entry: TimelineTx & { isFuture?: boolean };
  locale: string;
  muted: boolean;
  categories: ExpenseCategory[];
  onChanged: () => void;
}) {
  const t = useTranslations('timeline.list');
  const signed = formatSignedAmount(entry.amount, entry.type, locale);
  const isFuture = entry.isFuture === true;
  // Editable directly here — never bridges (computed, not user rows; A4).
  // Any transfer (one-off or a single materialized recurring occurrence)
  // uses the paired-atomic transfer path; any plain income/expense entry
  // (manual one-off, A1, or a single materialized recurring occurrence, A3
  // — editing/deleting either detaches it from the rule server-side) uses
  // EntryControls.
  const isEditableTransfer = entry.type === 'transfer' && !entry.isBridge;
  const isEditableEntry = !entry.isBridge && (entry.type === 'income' || entry.type === 'expense');
  const isRecurringOccurrence = entry.recurringItemId !== null;

  return (
    <div className="flex items-center gap-3 py-1.5 group">
      <Link
        href={sourceHref(entry, locale)}
        className="flex-1 min-w-0 truncate text-sm hover:underline"
        style={{ color: muted ? '#9CA3AF' : isFuture ? '#6B7280' : '#0F2044' }}
      >
        {entry.isBridge && <span className="mr-1">💳</span>}
        {isEditableTransfer && <span className="mr-1">🪙 →</span>}
        {isEditableEntry && isRecurringOccurrence && <span className="mr-1">🔁</span>}
        {entry.description ?? t('untitled')}
        {entry.installmentLabel && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>
            {entry.installmentLabel}
          </span>
        )}
      </Link>
      <span className="text-sm font-medium w-24 text-right shrink-0" style={{ color: muted ? '#9CA3AF' : signed.color, opacity: isFuture ? 0.75 : 1 }}>
        {signed.text}
      </span>
      {isEditableTransfer && <TransferControls entry={entry} locale={locale} onChanged={onChanged} />}
      {isEditableEntry && <EntryControls entry={entry} locale={locale} categories={categories} onChanged={onChanged} />}
    </div>
  );
}

export default function DayLedger({
  monthView,
  today,
  locale,
  categories,
  todayRef,
  onChanged,
}: {
  monthView: MonthView;
  today: string;
  locale: string;
  categories: ExpenseCategory[];
  todayRef?: RefObject<HTMLDivElement | null>;
  onChanged: () => void;
}) {
  const t = useTranslations('timeline.list');
  const { visibleDays, unbalancedDays, opensAt, closesAt, balancesBeginNote } = monthView;

  const isEmpty = visibleDays.length === 0 && unbalancedDays.length === 0;

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-4 text-sm" style={{ color: '#6B7280' }}>
        <span>{t('opensAt')} <strong style={{ color: '#0F2044' }}>{formatCurrency(opensAt, locale)}</strong></span>
        <span>{t('closesAt')} <strong style={{ color: '#0F2044' }}>{formatCurrency(closesAt, locale)}</strong></span>
      </div>

      {isEmpty && (
        <p className="text-center py-8 text-sm" style={{ color: '#9CA3AF' }}>{t('empty')}</p>
      )}

      {unbalancedDays.length > 0 && (
        <div className="mb-3 space-y-2">
          {unbalancedDays.map((day) => (
            <div key={day.date} className="rounded-xl p-3" style={{ background: '#F9FAFB', border: '1px dashed #D1D5DB' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold" style={{ color: '#6B7280' }}>{fmtDay(day.date, locale)}</span>
                <span className="text-xs italic" style={{ color: '#9CA3AF' }}>{t('noBalanceYet')}</span>
              </div>
              {day.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} locale={locale} muted categories={categories} onChanged={onChanged} />
              ))}
            </div>
          ))}
          {balancesBeginNote && (
            <p className="text-xs px-1" style={{ color: '#9CA3AF' }}>
              {t('balancesBegin', { date: fmtDay(monthView.month + '-01', locale) })}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {visibleDays.map((day) => {
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              ref={isToday ? todayRef : undefined}
              className="rounded-xl p-3"
              style={{
                background: day.isNegative ? '#FEF2F2' : isToday ? '#F0FDFD' : 'white',
                border: day.isNegative ? '1.5px solid #DC2626' : isToday ? '1.5px solid #2ABFBF' : '1px solid #F3F4F6',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: day.isNegative ? '#DC2626' : '#0F2044' }}>
                  {fmtDay(day.date, locale)}
                  {isToday && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#2ABFBF', color: 'white' }}>
                      {t('today')}
                    </span>
                  )}
                </span>
              </div>
              {(day.entries as TimelineEntry[]).map((entry) => (
                <EntryRow key={entry.id} entry={entry} locale={locale} muted={false} categories={categories} onChanged={onChanged} />
              ))}
              {/* Closing line — end-of-day balance, visually distinct from
                  entry amounts (a light rule above, bolder, right-aligned)
                  so scanning down the right edge still reads the balance
                  trajectory at a glance. Presentation only — same
                  day.endOfDayBalance, same negative-day styling as before. */}
              <div
                className="flex items-center justify-between pt-1.5 mt-1"
                style={{ borderTop: `1px solid ${day.isNegative ? '#FECACA' : '#F3F4F6'}` }}
              >
                <span className="text-xs" style={{ color: day.isNegative ? '#DC2626' : '#9CA3AF' }}>
                  {t('endOfDay')}
                </span>
                <span className="text-sm font-bold" style={{ color: day.isNegative ? '#DC2626' : '#0F2044' }}>
                  {formatCurrency(day.endOfDayBalance, locale)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

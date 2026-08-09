'use client';

// The Reserve Fund half of /savings (2026-08-08). Lifted VERBATIM out of the
// old /sinking-funds page — same fetch, same state, same cards, same history
// lists, same modal. The only edits are structural: the page shell (Navbar/
// Sidebar/<main>) moved up to the route, `locale` arrives as a prop instead
// of being re-derived from the pathname, and the old <h1> is now the
// section's <h2>. No behaviour changed.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { formatCurrency, monthName, SinkingFund, SinkingFundBuffer } from '@/components/dashboard/types';
import {
  firstOfNextMonth,
  anchorDayOfMonth,
  anchorDateForDayOfMonth,
  sameAnchorSchedule,
} from '@/lib/dateHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

// For monthly/semimonthly the schedule is a DAY, and only the day is ever
// read back out of the anchor — so that's what the family picks. For
// weekly/biweekly the anchor's full date sets the phase (every 7/14 days
// counted from it), so those need a real date instead.
const usesDayOfMonth = (cadence: Cadence) => cadence === 'monthly' || cadence === 'semimonthly';

type BufferData = SinkingFundBuffer & {
  contributionAmount: number | null;
  cadence: Cadence | null;
  secondDay: number | null;
  anchorDate: string | null;
  recurringItemId: string | null;
  nextContributionDate: string | null;
  tombstonesAfterBoundary: number;
  contributions: { id: string; date: string; description: string | null; amount: number }[];
  upcomingContributions: { id: string; date: string; description: string | null; amount: number }[];
  billsPaid: { id: string; date: string; description: string | null; amount: number }[];
};

export default function ReserveFundSection({ locale }: { locale: string }) {
  const t = useTranslations('sinkingFundsPage');
  const tDash = useTranslations('dashboard');
  const router = useRouter();

  const [funds, setFunds] = useState<SinkingFund[]>([]);
  const [buffer, setBuffer] = useState<BufferData | null>(null);
  const [loading, setLoading] = useState(true);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  // Day of the month the first contribution should come out on. Defaults to
  // today's day — the old hardcoded behaviour — so leaving it alone changes
  // nothing for anyone who doesn't care.
  const [startDay, setStartDay] = useState('');

  const [editingContribution, setEditingContribution] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [newCadence, setNewCadence] = useState<Cadence>('monthly');
  const [newSecondDay, setNewSecondDay] = useState('30');
  // Two shapes for the same field — see usesDayOfMonth above. Only the one
  // matching the currently-selected cadence is ever sent.
  const [newAnchorDay, setNewAnchorDay] = useState('');
  const [newAnchorDate, setNewAnchorDate] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  // Set when a save would move the schedule while detached occurrences exist
  // past the boundary. Shows the warning and turns Save into an explicit
  // confirm — the household can proceed, they just aren't surprised by it.
  const [scheduleWarning, setScheduleWarning] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const { today } = useBusinessToday();

  // Per-allocation edit (amount) and exclude/include — Build 4 Part A
  // follow-up (2026-07-22). Only one row editable at a time, same pattern
  // as RecurringList's row-level edit.
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [editFundAnnual, setEditFundAnnual] = useState('');
  const [editFundMonthly, setEditFundMonthly] = useState('');
  const [fundSaving, setFundSaving] = useState(false);
  const [fundError, setFundError] = useState('');

  // Contribution-follows-the-sum banner: shown whenever the recalculated
  // total (from active allocations) differs from what the recurring rule
  // is actually contributing today.
  const [contributionEffectiveFrom, setContributionEffectiveFrom] = useState('');
  const [updatingContribution, setUpdatingContribution] = useState(false);
  const [contributionUpdateError, setContributionUpdateError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/sinking-funds')
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        return res.json();
      })
      .then((d) => {
        if (!d) return;
        setFunds(d.funds ?? []);
        setBuffer(d.buffer ?? null);
      })
      .finally(() => setLoading(false));
  }, [router, locale]);

  useEffect(() => { load(); }, [load]);

  async function handleStartFunding() {
    const day = startDay === '' ? null : parseInt(startDay, 10);
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
      setStartError(t('dayInvalid'));
      return;
    }
    setStarting(true);
    setStartError('');
    try {
      const res = await fetch('/api/sinking-funds/start-funding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchorDay: day }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to start');
      load();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : t('startFundingError'));
    } finally {
      setStarting(false);
    }
  }

  function openEditContribution() {
    setNewAmount(String(buffer?.contributionAmount ?? buffer?.totalMonthlyProvision ?? ''));
    setNewCadence(buffer?.cadence ?? 'monthly');
    setNewSecondDay(String(buffer?.secondDay ?? '30'));
    // Both shapes seeded from the one stored anchor, so switching cadence
    // inside the form doesn't land on an empty field.
    setNewAnchorDay(buffer?.anchorDate ? String(anchorDayOfMonth(buffer.anchorDate)) : '');
    setNewAnchorDate(buffer?.anchorDate ?? '');
    setEditError('');
    setScheduleWarning(false);
    setEditingContribution(true);
  }

  function closeEditContribution() {
    setEditingContribution(false);
    setScheduleWarning(false);
    setEditError('');
  }

  // The anchor this form would send, in the shape the selected cadence needs.
  // null means "leave it alone" — the PATCH route falls back to the rule's
  // current anchor when anchorDate is absent.
  function resolveAnchorDate(): string | null {
    if (usesDayOfMonth(newCadence)) {
      const day = parseInt(newAnchorDay, 10);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      return anchorDateForDayOfMonth(day, today);
    }
    return newAnchorDate || null;
  }

  async function saveContribution(confirmedSchedule = false) {
    if (!buffer?.recurringItemId) return;
    const parsed = parseFloat(newAmount);
    if (!parsed || parsed <= 0) {
      setEditError(t('editAmountInvalid'));
      return;
    }
    if (usesDayOfMonth(newCadence) && newAnchorDay !== '') {
      const day = parseInt(newAnchorDay, 10);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        setEditError(t('dayInvalid'));
        return;
      }
    }

    const anchorDate = resolveAnchorDate();

    // Warn ONLY when the schedule actually moves. An amount-only change also
    // splits the rule, but dates don't move under it, so the tombstone
    // carry-forward lands exactly where it should and there is nothing to
    // warn about — firing here too would be noise that trains people to
    // click through.
    const scheduleMoved =
      newCadence !== (buffer.cadence ?? 'monthly') ||
      !sameAnchorSchedule(anchorDate, buffer.anchorDate, newCadence);
    if (scheduleMoved && buffer.tombstonesAfterBoundary > 0 && !confirmedSchedule) {
      setScheduleWarning(true);
      return;
    }

    setEditSaving(true);
    setEditError('');
    try {
      const res = await fetch(`/api/recurring/${buffer.recurringItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsed,
          cadence: newCadence,
          secondDay: newCadence === 'semimonthly' ? parseInt(newSecondDay, 10) : null,
          ...(anchorDate ? { anchorDate } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      closeEditContribution();
      load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('editError'));
    } finally {
      setEditSaving(false);
    }
  }

  async function doDelete() {
    if (!buffer?.linkedAccountId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/accounts/${buffer.linkedAccountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete');
      setConfirmDelete(false);
      load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  function startEditFund(fund: SinkingFund) {
    setEditingFundId(fund.id);
    setEditFundAnnual(String(fund.annual_amount));
    setEditFundMonthly(String(fund.monthly_provision));
    setFundError('');
  }

  function cancelEditFund() {
    setEditingFundId(null);
    setFundError('');
  }

  async function saveEditFund(id: string) {
    const annual = parseFloat(editFundAnnual);
    const monthly = parseFloat(editFundMonthly);
    if (!annual || annual <= 0 || !monthly || monthly <= 0) {
      setFundError(t('itemAmountInvalid'));
      return;
    }
    setFundSaving(true);
    setFundError('');
    try {
      const res = await fetch(`/api/sinking-funds/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annualAmount: annual, monthlyProvision: monthly }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      setEditingFundId(null);
      load();
    } catch (err) {
      setFundError(err instanceof Error ? err.message : t('itemSaveError'));
    } finally {
      setFundSaving(false);
    }
  }

  async function toggleFundActive(fund: SinkingFund) {
    setFundError('');
    try {
      const res = await fetch(`/api/sinking-funds/${fund.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !fund.active }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      load();
    } catch (err) {
      setFundError(err instanceof Error ? err.message : t('itemToggleError'));
    }
  }

  async function updateContributionToMatch() {
    if (!buffer?.recurringItemId) return;
    setUpdatingContribution(true);
    setContributionUpdateError('');
    try {
      const res = await fetch(`/api/recurring/${buffer.recurringItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: buffer.totalMonthlyProvision,
          effectiveFrom: contributionEffectiveFrom || firstOfNextMonth(today),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      setContributionEffectiveFrom('');
      load();
    } catch (err) {
      setContributionUpdateError(err instanceof Error ? err.message : t('contributionUpdateError'));
    } finally {
      setUpdatingContribution(false);
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

  const pastContributionsTotal = buffer?.contributions.reduce((s, c) => s + c.amount, 0) ?? 0;

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h2>

      {loading && (
        <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
      )}

      {!loading && funds.length === 0 && (
        <div className="rounded-2xl bg-white p-10 text-center" style={{ border: '1px solid #E5E7EB' }}>
          <p className="text-4xl mb-3">🏦</p>
          <p className="font-medium" style={{ color: '#0F2044' }}>{t('noFunds')}</p>
        </div>
      )}

      {!loading && funds.length > 0 && buffer && (
        <>
          {/* Buffer summary card */}
          <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: '1px solid #E5E7EB' }}>
            {!buffer.linkedAccountId ? (
              <>
                <p className="text-sm" style={{ color: '#6B7280' }}>{t('notStarted')}</p>
                {/* Contribution day — the whole point of this field is that
                    the household is paid on their own schedule, not on
                    whichever day they happened to open this page. */}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: '#6B7280' }}>
                    {t('startFundingDayLabel')}
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={startDay}
                      placeholder={String(Number(today.slice(8, 10)))}
                      onChange={(e) => setStartDay(e.target.value)}
                      className="w-20 px-2 py-1.5 rounded text-sm outline-none"
                      style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                    />
                  </label>
                  <p className="w-full text-xs" style={{ color: '#9CA3AF' }}>{t('startFundingDayHint')}</p>
                </div>
                {startError && <p className="text-sm" style={{ color: '#DC2626' }}>{startError}</p>}
                <button
                  onClick={handleStartFunding}
                  disabled={starting}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
                  style={{ background: '#0F2044', color: 'white' }}
                >
                  {starting
                    ? t('startingFunding')
                    : t('startFunding', { amount: formatCurrency(buffer.totalMonthlyProvision, locale) })}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-2xl font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(buffer.balance, locale)}
                  </span>
                  <span className="text-sm" style={{ color: '#6B7280' }}>{t('currentBalance')}</span>
                </div>

                {editingContribution ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      className="w-32 px-2 py-1.5 rounded text-sm outline-none"
                      style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                    />
                    <select
                      value={newCadence}
                      onChange={(e) => setNewCadence(e.target.value as Cadence)}
                      className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                      style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                    >
                      <option value="monthly">{t('cadenceMonthly')}</option>
                      <option value="biweekly">{t('cadenceBiweekly')}</option>
                      <option value="semimonthly">{t('cadenceSemimonthly')}</option>
                      <option value="weekly">{t('cadenceWeekly')}</option>
                    </select>
                    {/* When the contribution comes out. A day-of-month for
                        monthly/semimonthly (only the day is ever read back);
                        a real date for weekly/biweekly, where the anchor sets
                        the phase. Same 1-31 number-input pattern the second
                        semimonthly day beside it already uses. */}
                    {usesDayOfMonth(newCadence) ? (
                      <span className="flex items-center gap-1.5">
                        <label className="text-xs" style={{ color: '#6B7280' }}>{t('contributionDayLabel')}</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={newAnchorDay}
                          onChange={(e) => setNewAnchorDay(e.target.value)}
                          className="w-16 px-2 py-1.5 rounded text-sm outline-none"
                          style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                        />
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <label className="text-xs" style={{ color: '#6B7280' }}>{t('firstDateLabel')}</label>
                        <input
                          type="date"
                          value={newAnchorDate}
                          onChange={(e) => setNewAnchorDate(e.target.value)}
                          className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                          style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                        />
                      </span>
                    )}
                    {newCadence === 'semimonthly' && (
                      <span className="flex items-center gap-1.5">
                        <label className="text-xs" style={{ color: '#6B7280' }}>{t('secondDay')}</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={newSecondDay}
                          onChange={(e) => setNewSecondDay(e.target.value)}
                          className="w-16 px-2 py-1.5 rounded text-sm outline-none"
                          style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                        />
                      </span>
                    )}
                    <button
                      onClick={() => saveContribution(scheduleWarning)}
                      disabled={editSaving}
                      className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                      style={{ background: scheduleWarning ? '#B45309' : '#2ABFBF' }}
                    >
                      {editSaving
                        ? t('savingContribution')
                        : scheduleWarning
                          ? t('scheduleWarningConfirm')
                          : t('saveContribution')}
                    </button>
                    <button
                      onClick={closeEditContribution}
                      className="px-3 py-1.5 rounded text-sm"
                      style={{ color: '#6B7280' }}
                    >
                      {t('cancelEdit')}
                    </button>
                    {editError && <p className="w-full text-sm" style={{ color: '#DC2626' }}>{editError}</p>}
                    {/* Detached-occurrence warning — shown only when this save
                        would move the schedule AND singles were edited or
                        removed past the boundary. They can proceed; the point
                        is that they aren't surprised afterwards. */}
                    {scheduleWarning && (
                      <div className="w-full rounded-xl p-3 space-y-1" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                        <p className="text-sm font-semibold" style={{ color: '#92400E' }}>{t('scheduleWarningTitle')}</p>
                        <p className="text-xs" style={{ color: '#92400E' }}>
                          {t('scheduleWarningBody', { count: buffer.tombstonesAfterBoundary })}
                        </p>
                      </div>
                    )}
                    <p className="w-full text-xs" style={{ color: '#9CA3AF' }}>
                      {usesDayOfMonth(newCadence) ? `${t('contributionDayHint')} ` : `${t('firstDateHint')} `}
                      {t('editEffectiveNote')}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium" style={{ color: '#0F2044' }}>
                      {formatCurrency(buffer.contributionAmount ?? buffer.totalMonthlyProvision, locale)}
                      {t(`cadenceShort.${buffer.cadence ?? 'monthly'}`)}
                      {buffer.nextContributionDate && ` · ${t('nextContribution', { date: fmtDate(buffer.nextContributionDate) })}`}
                    </p>
                    <div className="flex gap-3">
                      <button onClick={openEditContribution} className="text-xs font-semibold" style={{ color: '#2ABFBF' }}>
                        {t('editContributionCta')}
                      </button>
                      <button onClick={() => setConfirmDelete(true)} className="text-xs font-semibold" style={{ color: '#DC2626' }}>
                        {t('deleteCta')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Per-fund editable allocation list */}
          <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
            <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
              {t('whatItCovers')}
            </h3>
            <div className="space-y-2">
              {funds.map((fund) => (
                <div key={fund.id} className="py-1.5" style={{ opacity: fund.active ? 1 : 0.55 }}>
                  {editingFundId === fund.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium flex-1 min-w-[100px]" style={{ color: '#0F2044' }}>
                        {fund.name}
                      </span>
                      <label className="flex items-center gap-1 text-xs" style={{ color: '#6B7280' }}>
                        {t('itemAnnualLabel')}
                        <input
                          type="number"
                          step="0.01"
                          value={editFundAnnual}
                          onChange={(e) => setEditFundAnnual(e.target.value)}
                          className="w-24 px-2 py-1 rounded text-sm outline-none"
                          style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs" style={{ color: '#6B7280' }}>
                        {t('itemMonthlyLabel')}
                        <input
                          type="number"
                          step="0.01"
                          value={editFundMonthly}
                          onChange={(e) => setEditFundMonthly(e.target.value)}
                          className="w-24 px-2 py-1 rounded text-sm outline-none"
                          style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                        />
                      </label>
                      <button
                        onClick={() => saveEditFund(fund.id)}
                        disabled={fundSaving}
                        className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                        style={{ background: '#2ABFBF' }}
                      >
                        {fundSaving ? t('savingItem') : t('saveItem')}
                      </button>
                      <button onClick={cancelEditFund} className="px-3 py-1.5 rounded text-sm" style={{ color: '#6B7280' }}>
                        {t('cancelEdit')}
                      </button>
                      {fundError && <p className="w-full text-sm" style={{ color: '#DC2626' }}>{fundError}</p>}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-medium" style={{ color: '#0F2044' }}>
                          {fund.name}
                          {!fund.active && (
                            <span className="ml-2 text-xs font-semibold" style={{ color: '#9CA3AF' }}>
                              {t('excludedBadge')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs" style={{ color: '#6B7280' }}>
                          {monthName(fund.due_month, locale)}{fund.due_month ? ' · ' : ''}{formatCurrency(fund.annual_amount, locale)}{tDash('perYear')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-semibold" style={{ color: fund.active ? '#2ABFBF' : '#9CA3AF' }}>
                          {formatCurrency(fund.monthly_provision, locale)}{tDash('perMonth')}
                        </p>
                        <button onClick={() => startEditFund(fund)} className="text-xs font-semibold" style={{ color: '#2ABFBF' }}>
                          {t('editItemCta')}
                        </button>
                        <button
                          onClick={() => toggleFundActive(fund)}
                          className="text-xs font-semibold"
                          style={{ color: fund.active ? '#DC2626' : '#16A34A' }}
                        >
                          {fund.active ? t('excludeCta') : t('includeCta')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Contribution follows the sum — shown only when the recalculated
              total (from active allocations, above) has drifted from what the
              recurring rule actually contributes today. Honesty banner: the
              family sees the effect before committing it. */}
          {buffer.linkedAccountId && buffer.recurringItemId && buffer.contributionAmount !== null &&
            buffer.totalMonthlyProvision !== buffer.contributionAmount && (
            <div className="rounded-2xl p-6 space-y-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <p className="text-sm font-semibold" style={{ color: '#92400E' }}>
                {t('contributionChangeBanner', {
                  from: formatCurrency(buffer.contributionAmount, locale),
                  to: formatCurrency(buffer.totalMonthlyProvision, locale),
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs" style={{ color: '#78350F' }}>
                  {t('effectiveFrom')}
                  <input
                    type="date"
                    value={contributionEffectiveFrom || firstOfNextMonth(today)}
                    min={today}
                    onChange={(e) => setContributionEffectiveFrom(e.target.value)}
                    className="px-2 py-1.5 rounded text-sm outline-none bg-white"
                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                  />
                </label>
                <button
                  onClick={updateContributionToMatch}
                  disabled={updatingContribution}
                  className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: '#0F2044' }}
                >
                  {updatingContribution ? t('updatingContribution') : t('updateContributionCta')}
                </button>
              </div>
              <p className="text-xs" style={{ color: '#92400E' }}>{t('contributionUpdateNote')}</p>
              {contributionUpdateError && <p className="text-sm" style={{ color: '#DC2626' }}>{contributionUpdateError}</p>}
            </div>
          )}

          {buffer.linkedAccountId && (
            <>
              {/* Contribution history */}
              <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                  {t('contributionHistory')}
                </h3>
                {buffer.contributions.length === 0 ? (
                  <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('noHistory')}</p>
                ) : (
                  <div className="space-y-1">
                    {buffer.contributions.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid #F9FAFB' }}>
                        <span className="text-sm w-24 shrink-0" style={{ color: '#6B7280' }}>{fmtDate(c.date)}</span>
                        <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#0F2044' }}>{c.description ?? '—'}</span>
                        <span className="text-sm font-medium shrink-0" style={{ color: '#2ABFBF' }}>+{formatCurrency(c.amount, locale)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {buffer.upcomingContributions.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold mt-4 mb-2 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                      {t('upcoming')}
                    </h4>
                    <div className="space-y-1">
                      {buffer.upcomingContributions.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid #F9FAFB' }}>
                          <span className="text-sm w-24 shrink-0" style={{ color: '#9CA3AF' }}>{fmtDate(c.date)}</span>
                          <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#9CA3AF' }}>{c.description ?? '—'}</span>
                          <span className="text-sm font-medium shrink-0" style={{ color: '#9CA3AF' }}>+{formatCurrency(c.amount, locale)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Bills paid from it */}
              <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                  {t('billsPaid')}
                </h3>
                {buffer.billsPaid.length === 0 ? (
                  <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('noBillsPaid')}</p>
                ) : (
                  <div className="space-y-1">
                    {buffer.billsPaid.map((b) => (
                      <div key={b.id} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid #F9FAFB' }}>
                        <span className="text-sm w-24 shrink-0" style={{ color: '#6B7280' }}>{fmtDate(b.date)}</span>
                        <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#0F2044' }}>{b.description ?? '—'}</span>
                        <span className="text-sm font-medium shrink-0" style={{ color: '#DC2626' }}>−{formatCurrency(b.amount, locale)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Delete confirmation — honest consequences enumerated from data
          already loaded on this page, no extra fetch, same convention as
          Goals' own delete confirmation. */}
      {confirmDelete && buffer && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-3" style={{ color: '#0F2044' }}>{t('confirmDeleteTitle')}</p>
            <p className="text-sm mb-2" style={{ color: '#6B7280' }}>
              {t('confirmDeleteStops', { amount: formatCurrency(buffer.contributionAmount ?? buffer.totalMonthlyProvision, locale) })}
            </p>
            {buffer.upcomingContributions.length > 0 && (
              <p className="text-sm mb-2" style={{ color: '#6B7280' }}>
                {t('confirmDeleteUpcoming', { count: buffer.upcomingContributions.length })}
              </p>
            )}
            <p className="text-sm mb-2" style={{ color: '#6B7280' }}>
              {t('confirmDeleteMoneyKept', { amount: formatCurrency(pastContributionsTotal, locale) })}
            </p>
            {deleteError && <p className="text-sm mb-2" style={{ color: '#DC2626' }}>{deleteError}</p>}
            <div className="flex flex-col gap-2 mt-3">
              <button
                onClick={doDelete}
                disabled={deleting}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium disabled:opacity-50"
                style={{ background: '#DC2626' }}
              >
                {deleting ? t('deleting') : t('confirmDeleteBtn')}
              </button>
              <button
                onClick={() => { setConfirmDelete(false); setDeleteError(''); }}
                className="w-full py-2.5 rounded-full text-sm font-medium"
                style={{ color: '#6B7280' }}
              >
                {t('cancelEdit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

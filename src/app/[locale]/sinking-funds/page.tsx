'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import { formatCurrency, monthName, SinkingFund, SinkingFundBuffer } from '@/components/dashboard/types';
import { firstOfNextMonth } from '@/lib/dateHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

type BufferData = SinkingFundBuffer & {
  contributionAmount: number | null;
  cadence: Cadence | null;
  secondDay: number | null;
  recurringItemId: string | null;
  nextContributionDate: string | null;
  contributions: { id: string; date: string; description: string | null; amount: number }[];
  upcomingContributions: { id: string; date: string; description: string | null; amount: number }[];
  billsPaid: { id: string; date: string; description: string | null; amount: number }[];
};

export default function SinkingFundsPage() {
  const t = useTranslations('sinkingFundsPage');
  const tDash = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [funds, setFunds] = useState<SinkingFund[]>([]);
  const [buffer, setBuffer] = useState<BufferData | null>(null);
  const [loading, setLoading] = useState(true);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const [editingContribution, setEditingContribution] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [newCadence, setNewCadence] = useState<Cadence>('monthly');
  const [newSecondDay, setNewSecondDay] = useState('30');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

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
    setStarting(true);
    setStartError('');
    try {
      const res = await fetch('/api/sinking-funds/start-funding', { method: 'POST' });
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
    setEditError('');
    setEditingContribution(true);
  }

  async function saveContribution() {
    if (!buffer?.recurringItemId) return;
    const parsed = parseFloat(newAmount);
    if (!parsed || parsed <= 0) {
      setEditError(t('editAmountInvalid'));
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
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      setEditingContribution(false);
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
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>

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
                            onClick={saveContribution}
                            disabled={editSaving}
                            className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                            style={{ background: '#2ABFBF' }}
                          >
                            {editSaving ? t('savingContribution') : t('saveContribution')}
                          </button>
                          <button
                            onClick={() => setEditingContribution(false)}
                            className="px-3 py-1.5 rounded text-sm"
                            style={{ color: '#6B7280' }}
                          >
                            {t('cancelEdit')}
                          </button>
                          {editError && <p className="w-full text-sm" style={{ color: '#DC2626' }}>{editError}</p>}
                          <p className="w-full text-xs" style={{ color: '#9CA3AF' }}>{t('editEffectiveNote')}</p>
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
                  <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                    {t('whatItCovers')}
                  </h2>
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
                      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                        {t('contributionHistory')}
                      </h2>
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
                          <h3 className="text-xs font-semibold mt-4 mb-2 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                            {t('upcoming')}
                          </h3>
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
                      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                        {t('billsPaid')}
                      </h2>
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

          </div>
        </div>
      </div>

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
    </main>
  );
}

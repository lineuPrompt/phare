'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import TimelineHeader from '@/components/timeline/TimelineHeader';
import DayLedger from '@/components/timeline/DayLedger';
import AnchorForm from '@/components/timeline/AnchorForm';
import TimelineEntryForm from '@/components/timeline/TimelineEntryForm';
import { buildMonthView, availableMonths, type UnbalancedDay } from '@/lib/timelineDisplayHelpers';
import type { TimelineDay, DipInfo } from '@/lib/timelineHelpers';
import type { Account, ExpenseCategory } from '@/components/expenses/types';
import { formatCurrency } from '@/components/expenses/types';
import { useBusinessToday } from '@/lib/useBusinessToday';
import UpgradeButton from '@/components/billing/UpgradeButton';

// Closing position for the viewed month — read directly off the already-
// computed monthView.closesAt (buildMonthView, Phase 3). No new math: this
// is the one figure the founder wants preserved from the retired Planner.
function RemainingCashStrip({ amount, label, locale }: { amount: number; label: string; locale: string }) {
  const positive = amount >= 0;
  return (
    <div
      className="rounded-2xl p-6 flex items-center justify-between"
      style={{
        background: positive ? '#F0FDF4' : '#FEF2F2',
        border: `2px solid ${positive ? '#86EFAC' : '#FECACA'}`,
      }}
    >
      <span className="text-base font-semibold" style={{ color: positive ? '#15803D' : '#B91C1C' }}>
        {label}
      </span>
      <span className="text-2xl font-bold" style={{ color: positive ? '#15803D' : '#B91C1C' }}>
        {formatCurrency(amount, locale)}
      </span>
    </div>
  );
}

type TimelineResponse =
  | {
      ok: true;
      balancesStartDate: string;
      openingBalance: number;
      closingBalance: number;
      todayBalance: number | null;
      days: TimelineDay[];
      dip: DipInfo | null;
      nextIncomeDate: string | null;
      unbalancedDays: UnbalancedDay[];
      // Last month this household may navigate to. Absent on older responses.
      horizonEndMonth?: string;
      isPro?: boolean;
    }
  | { ok: false; reason: 'no_anchor' };

type AnchorRow = { id: string; anchor_date: string; balance: number };

export default function TimelinePage() {
  const t = useTranslations('timeline');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
  const { today, month: currentMonth } = useBusinessToday();

  // The dashboard snapshot links here with ?month=YYYY-MM so the two views
  // of "this month" stay the same month — read once on mount, same as any
  // deep link. Falls back to the current month if missing/malformed.
  const monthParam = searchParams.get('month');
  const initialMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth;

  const [chequingId, setChequingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [showReAnchor, setShowReAnchor] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [goalAccounts, setGoalAccounts] = useState<{ id: string; name: string; isDebt: boolean }[]>([]);

  const todayRef = useRef<HTMLDivElement | null>(null);

  // Resolve the household's chequing account once.
  useEffect(() => {
    fetch('/api/accounts')
      .then(async (r) => {
        if (r.status === 401) { router.push(`/${locale}/signin`); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: { accounts: Account[] } | null) => {
        const chequing = d?.accounts.find((a) => a.type === 'chequing');
        if (chequing) setChequingId(chequing.id);
      })
      .catch(() => {});

    fetch('/api/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { categories: { id: string; name: string }[] } | null) => {
        if (d) setCategories(d.categories.map((c) => ({ ...c, type: 'expense' })));
      })
      .catch(() => {});

    fetch('/api/goals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { goals: { id: string; name: string; isDebt: boolean }[] } | null) => {
        if (d) setGoalAccounts(d.goals.map((g) => ({ id: g.id, name: g.name, isDebt: g.isDebt })));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!chequingId) return;
    setLoading(true);

    fetch(`/api/anchors?account=${chequingId}`)
      .then((r) => (r.status === 401 ? null : r.ok ? r.json() : null))
      .then((d: { anchors: AnchorRow[] } | null) => {
        if (d === null) { router.push(`/${locale}/signin`); return null; }

        const anchors = d.anchors ?? [];
        let windowStartParam = '';
        if (anchors.length > 0) {
          const earliestMonth = anchors[0].anchor_date.slice(0, 7);
          const defaultMonth = currentMonth;
          if (earliestMonth < defaultMonth) {
            windowStartParam = `&windowStart=${earliestMonth}-01`;
          }
        }

        // pageView=1 marks this as a genuine Timeline page load (distinct
        // from the dashboard's own call to this endpoint for the dip tile)
        // — see eventLogger.ts's FUNNEL INSTRUMENTATION note.
        return fetch(`/api/timeline?account=${chequingId}${windowStartParam}&pageView=1`)
          .then((r) => (r.status === 401 ? null : r.ok ? r.json() : null));
      })
      .then((d: TimelineResponse | null) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [chequingId, locale, router, currentMonth]);

  useEffect(() => { load(); }, [load]);

  // Auto-scroll today's row into view whenever the current month is shown.
  useEffect(() => {
    if (selectedMonth === currentMonth && todayRef.current) {
      todayRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selectedMonth, data, currentMonth]);

  const onAnchorSaved = () => {
    setShowReAnchor(false);
    load();
  };

  const onEntrySaved = () => {
    setShowAddEntry(false);
    load();
  };

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
            {children}
          </div>
        </div>
      </div>
    </main>
  );

  if (loading && !data) {
    return shell(<p className="text-center py-12 text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>);
  }

  if (!chequingId || !data) {
    return shell(<p className="text-center py-12 text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>);
  }

  if (!data.ok) {
    return shell(
      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <p className="text-lg font-semibold mb-2" style={{ color: '#0F2044' }}>{t('noAnchor.title')}</p>
        <p className="text-sm mb-6" style={{ color: '#6B7280' }}>{t('noAnchor.body')}</p>
        <AnchorForm accountId={chequingId} onSaved={onAnchorSaved} />
      </div>
    );
  }

  const windowEndDate = data.days.length > 0 ? data.days[data.days.length - 1].date : data.balancesStartDate;

  // The month nav derives its range from the DATA WINDOW (balancesStartDate ..
  // windowEndDate), not from plan.months — so bounding the projection chain in
  // the API left the ledger fully navigable. Capping the forward end here is
  // what makes the two agree.
  //
  // Only the FORWARD end is capped. availableMonths still starts at
  // balancesStartDate, so a free household keeps every past month of its own
  // history: the pricing card sells a projection horizon, not an archive.
  //
  // The API still returns the full 12-month day set; this trims which months are
  // reachable, and nothing about what was computed or materialised changes.
  const allMonths = availableMonths(data.balancesStartDate, windowEndDate);
  const horizonEnd = data.horizonEndMonth ?? null;
  const months = horizonEnd ? allMonths.filter((m) => m <= horizonEnd) : allMonths;
  const horizonTrimmed = months.length < allMonths.length;

  // A month can be selected that the cap has just removed — a ?month= link, or
  // a household that dropped to free while sitting on month 9. indexOf would
  // return -1 and disable BOTH arrows, stranding them with no way back. Clamp
  // to the last reachable month instead.
  const effectiveMonth =
    months.length > 0 && !months.includes(selectedMonth) && selectedMonth > (horizonEnd ?? '9999-99')
      ? months[months.length - 1]
      : selectedMonth;
  const monthIdx = months.indexOf(effectiveMonth);
  const monthView = buildMonthView(data.days, data.unbalancedDays, data.openingBalance, data.balancesStartDate, effectiveMonth);

  const goPrev = () => { if (monthIdx > 0) setSelectedMonth(months[monthIdx - 1]); };
  const goNext = () => { if (monthIdx >= 0 && monthIdx < months.length - 1) setSelectedMonth(months[monthIdx + 1]); };
  const goToday = () => setSelectedMonth(currentMonth);

  const monthLabel = new Date(effectiveMonth + '-01T00:00:00').toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' }
  );

  return shell(
    <>
      <TimelineHeader todayBalance={data.todayBalance} dip={data.dip} windowEndDate={windowEndDate} locale={locale} />

      {/* Add entry — the one place chequing transactions get added by hand */}
      <div>
        {!showAddEntry && (
          <button
            onClick={() => setShowAddEntry(true)}
            className="px-5 py-2.5 rounded-full text-sm font-semibold cursor-pointer hover:opacity-90 transition-all"
            style={{ background: '#0F2044', color: 'white' }}
          >
            + {t('addEntry.cta')}
          </button>
        )}
        {showAddEntry && (
          <TimelineEntryForm
            accountId={chequingId}
            categories={categories}
            goalAccounts={goalAccounts}
            onSaved={onEntrySaved}
            onCancel={() => setShowAddEntry(false)}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={monthIdx <= 0}
          title={monthIdx <= 0 ? t('nav.outOfRange') : undefined}
          className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          ← {t('nav.prev')}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: '#0F2044' }}>{monthLabel}</span>
          {effectiveMonth !== currentMonth && (
            <button onClick={goToday} className="text-xs px-2 py-1 rounded-full cursor-pointer" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>
              {t('nav.today')}
            </button>
          )}
        </div>
        <button
          onClick={goNext}
          disabled={monthIdx < 0 || monthIdx >= months.length - 1}
          title={monthIdx >= months.length - 1 ? t('nav.outOfRange') : undefined}
          className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          {t('nav.next')} →
        </button>
      </div>

      {monthView && (
        <DayLedger
          monthView={monthView}
          today={today}
          locale={locale}
          categories={categories}
          todayRef={todayRef}
          onChanged={load}
        />
      )}

      {/* At the paywall boundary, say what is behind it. The nav arrow's
          existing "out of range" title would be a lie here: those months exist
          and are computed — they are simply not included in the free tier. */}
      {horizonTrimmed && monthIdx === months.length - 1 && (
        <div className="rounded-xl p-4" style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}>
          <p className="text-sm mb-3" style={{ color: '#0F766E' }}>
            {t('horizonLocked', { count: allMonths.length - months.length })}
          </p>
          <UpgradeButton className="text-sm" />
        </div>
      )}

      {monthView && (
        <RemainingCashStrip
          amount={monthView.closesAt}
          label={t('remainingCash.label', { month: monthLabel })}
          locale={locale}
        />
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={monthIdx <= 0}
          title={monthIdx <= 0 ? t('nav.outOfRange') : undefined}
          className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          ← {t('nav.prev')}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: '#0F2044' }}>{monthLabel}</span>
          {effectiveMonth !== currentMonth && (
            <button onClick={goToday} className="text-xs px-2 py-1 rounded-full cursor-pointer" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>
              {t('nav.today')}
            </button>
          )}
        </div>
        <button
          onClick={goNext}
          disabled={monthIdx < 0 || monthIdx >= months.length - 1}
          title={monthIdx >= months.length - 1 ? t('nav.outOfRange') : undefined}
          className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          {t('nav.next')} →
        </button>
      </div>

      <div>
        {!showReAnchor && (
          <button onClick={() => setShowReAnchor(true)} className="text-sm cursor-pointer" style={{ color: '#6B7280' }}>
            {t('reAnchor.cta')}
          </button>
        )}
        {showReAnchor && (
          <div className="rounded-2xl bg-white p-6 mt-2" style={{ border: '1px solid #E5E7EB' }}>
            <AnchorForm
              accountId={chequingId}
              defaultDate={today}
              defaultBalance={data.todayBalance ?? undefined}
              onSaved={onAnchorSaved}
              onCancel={() => setShowReAnchor(false)}
            />
          </div>
        )}
      </div>
    </>
  );
}

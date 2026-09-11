'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import CardDecisionView, { EnvelopeItem } from '@/components/cards/CardDecisionView';
import CardEnvelopeEditor from '@/components/cards/CardEnvelopeEditor';
import CardGrid from '@/components/cards/CardGrid';
import CrossCardView, { CardOverviewRow } from '@/components/cards/CrossCardView';
import ExpenseForm from '@/components/expenses/ExpenseForm';
import UpgradeButton from '@/components/billing/UpgradeButton';
import { GridData, CategoryEntryLine, CycleState, PastPlanState } from '@/lib/envelopeHelpers';
import { Account } from '@/components/expenses/types';
import { useBusinessToday } from '@/lib/useBusinessToday';

type Category = { id: string; name: string };

type EnvelopeData = {
  card: Account;
  totalGoal: number | null;
  envelopeItems: EnvelopeItem[];
  uncategorized: number;
  totalSpent: number;
  categories: Category[];
  entriesByCategory: Record<string, CategoryEntryLine[]>;
  uncategorizedEntries: CategoryEntryLine[];
  cycleState: CycleState;
  pastPlan: PastPlanState | null;
};

// GET /api/cards/months — the reachable range, queried from real data.
type MonthRange = {
  months: string[];
  floorMonth: string;
  currentMonth: string;
  horizonEndMonth: string;
  isPro: boolean;
  lockedMonthCount: number;
};

function monthLabel(yyyyMM: string, locale: string): string {
  return new Date(yyyyMM + '-01T00:00:00').toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' }
  );
}

export default function CardsPage() {
  const t = useTranslations('cards');
  const tNav = useTranslations('timeline.nav');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const { month: currentMonth } = useBusinessToday();

  // A Timeline bridge row deep-links here with ?card=<id>&month=<YYYY-MM> —
  // read once on mount, same pattern as the Timeline page's own ?month=
  // deep link from the dashboard.
  const cardParam = searchParams.get('card');
  const monthParamRaw = searchParams.get('month');
  const monthParam = monthParamRaw && /^\d{4}-\d{2}$/.test(monthParamRaw) ? monthParamRaw : null;

  // The reachable months come from GET /api/cards/months: from the earliest
  // cycle with real card data or a saved plan, to the entitled horizon (the
  // same one the Timeline uses). This replaced a fixed "current − 1 …
  // current + 11" list, whose −1 existed only so a bridge deep link could
  // reach last month — a bridge only exists when there was spend, so the
  // data floor already covers that month.
  const [range, setRange] = useState<MonthRange | null>(null);

  const [cards, setCards]               = useState<Account[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth]   = useState(monthParam ?? currentMonth);
  const [envelopeData, setEnvelopeData]     = useState<EnvelopeData | null>(null);
  const [gridData, setGridData]             = useState<GridData | null>(null);
  const [overview, setOverview]             = useState<CardOverviewRow[]>([]);
  const [loadingEnv, setLoadingEnv]         = useState(false);
  const [loadingGrid, setLoadingGrid]       = useState(false);
  const [editingEnvelope, setEditingEnvelope] = useState(false);

  // A selected month outside the reachable range — a stale ?month= link, or
  // a household that dropped to free while viewing month 9 — would leave
  // both arrows disabled with nothing to click. Clamp to the nearest end
  // instead (the Timeline clamps the same way).
  const reachable = range?.months ?? [];
  const effectiveMonth =
    reachable.length === 0 ? selectedMonth
    : selectedMonth < reachable[0] ? reachable[0]
    : selectedMonth > reachable[reachable.length - 1] ? reachable[reachable.length - 1]
    : selectedMonth;
  const monthIdx = reachable.indexOf(effectiveMonth);
  const atLastMonth = reachable.length > 0 && monthIdx === reachable.length - 1;

  const goPrev = () => { if (monthIdx > 0) setSelectedMonth(reachable[monthIdx - 1]); };
  const goNext = () => { if (monthIdx >= 0 && monthIdx < reachable.length - 1) setSelectedMonth(reachable[monthIdx + 1]); };
  const goToday = () => setSelectedMonth(currentMonth);

  useEffect(() => {
    fetch('/api/cards/months')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MonthRange | null) => { if (d) setRange(d); })
      .catch(() => {});
  }, []);

  // Load credit cards on mount
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts: Account[] } | null) => {
        if (!d) return;
        const creditCards = d.accounts.filter((a) => a.type === 'credit_card');
        setCards(creditCards);
        if (creditCards.length > 0 && !selectedCardId) {
          const deepLinked = cardParam && creditCards.some((c) => c.id === cardParam) ? cardParam : null;
          setSelectedCardId(deepLinked ?? creditCards[0].id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEnvelope = useCallback(() => {
    if (!selectedCardId) return;
    setLoadingEnv(true);
    fetch(`/api/card-envelope?cardId=${selectedCardId}&month=${effectiveMonth}&locale=${locale}`)
      .then(async (r) => {
        if (r.status === 401) { router.push(`/${locale}/signin`); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: EnvelopeData | null) => { if (d) setEnvelopeData(d); })
      .finally(() => setLoadingEnv(false));
  }, [selectedCardId, effectiveMonth, router, locale]);

  // The grid's window follows the picked month (server-side
  // gridWindowMonths): current/future → today's forward window; past → the
  // window starts at the picked month.
  const loadGrid = useCallback(() => {
    if (!selectedCardId) return;
    setLoadingGrid(true);
    fetch(`/api/card-envelope/grid?cardId=${selectedCardId}&month=${effectiveMonth}&locale=${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GridData | null) => { if (d) setGridData(d); })
      .finally(() => setLoadingGrid(false));
  }, [selectedCardId, effectiveMonth, locale]);

  const loadOverview = useCallback(() => {
    fetch(`/api/cards/overview?month=${effectiveMonth}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cards: CardOverviewRow[] } | null) => { if (d) setOverview(d.cards); })
      .catch(() => {});
  }, [effectiveMonth]);

  useEffect(() => {
    if (!selectedCardId) return;
    setEnvelopeData(null);
    setGridData(null);
    setEditingEnvelope(false);
    loadEnvelope();
    loadGrid();
  }, [selectedCardId, effectiveMonth, loadEnvelope, loadGrid]);

  useEffect(() => {
    if (cards.length === 0) return;
    loadOverview();
  }, [cards, effectiveMonth, loadOverview]);

  // Closed statement cycle: the plan is history. The server refuses the
  // write (POST /api/card-envelope → 409); hiding the editor here is only so
  // nobody is offered a button that cannot work.
  const planLocked = envelopeData?.cycleState === 'closed';

  const onEnvelopeSaved = () => {
    setEditingEnvelope(false);
    loadEnvelope();
    loadGrid();
    loadOverview();
  };

  const onExpenseSaved = () => {
    loadEnvelope();
    loadGrid();
    loadOverview();
  };

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>

            {/* No credit cards state */}
            {cards.length === 0 && (
              <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
                <p className="text-sm mb-1" style={{ color: '#6B7280' }}>{t('noCards')}</p>
                <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('noCardsHint')}</p>
              </div>
            )}

            {cards.length > 1 && overview.length > 0 && (
              <CrossCardView
                cards={overview}
                monthLabel={monthLabel(effectiveMonth, locale)}
                locale={locale}
              />
            )}

            {cards.length > 0 && (
              <>
                {/* Card selector tabs */}
                <div className="flex gap-2 flex-wrap">
                  {cards.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCardId(c.id)}
                      className="px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all"
                      style={{
                        background: selectedCardId === c.id ? '#0F2044' : 'white',
                        color: selectedCardId === c.id ? 'white' : '#6B7280',
                        border: selectedCardId === c.id ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                      }}
                    >
                      💳 {c.name}
                    </button>
                  ))}
                </div>

                {/* Statement-month picker — Previous / month dropdown / Next,
                    the Timeline's navigation pattern, over the range
                    GET /api/cards/months returned. A pill per month stopped
                    scaling once history could reach back without limit. */}
                {range && reachable.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={goPrev}
                      disabled={monthIdx <= 0}
                      title={monthIdx <= 0 ? tNav('outOfRange') : undefined}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed shrink-0"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    >
                      ← <span className="hidden sm:inline">{tNav('prev')}</span>
                    </button>
                    <div className="flex items-center gap-2 min-w-0">
                      <select
                        value={effectiveMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        aria-label={t('nav.pickMonth')}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer outline-none min-w-0"
                        style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                      >
                        {reachable.map((m) => (
                          <option key={m} value={m}>{monthLabel(m, locale)}</option>
                        ))}
                      </select>
                      {effectiveMonth !== currentMonth && (
                        <button onClick={goToday} className="text-xs px-2 py-1 rounded-full cursor-pointer whitespace-nowrap" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>
                          {tNav('today')}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={goNext}
                      disabled={monthIdx < 0 || atLastMonth}
                      title={atLastMonth && range.isPro ? tNav('outOfRange') : undefined}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed shrink-0"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    >
                      <span className="hidden sm:inline">{tNav('next')}</span> →
                    </button>
                  </div>
                )}

                {/* At the free horizon, say what is behind it — "out of range"
                    would be false: those months exist, they are Pro. Same
                    treatment as the Timeline's own boundary. */}
                {range && !range.isPro && atLastMonth && range.lockedMonthCount > 0 && (
                  <div className="rounded-xl p-4" style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}>
                    <p className="text-sm mb-3" style={{ color: '#0F766E' }}>
                      {t('nav.horizonLocked', { count: range.lockedMonthCount })}
                    </p>
                    <UpgradeButton className="text-sm" />
                  </div>
                )}

                {loadingEnv && (
                  <p className="text-center py-12 text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>
                )}

                {!loadingEnv && envelopeData && (
                  <>
                    {/* Decision view */}
                    {(!editingEnvelope || planLocked) && (
                      <CardDecisionView
                        totalGoal={envelopeData.totalGoal}
                        totalSpent={envelopeData.totalSpent}
                        envelopeItems={envelopeData.envelopeItems}
                        uncategorized={envelopeData.uncategorized}
                        entriesByCategory={envelopeData.entriesByCategory}
                        uncategorizedEntries={envelopeData.uncategorizedEntries}
                        locale={locale}
                        onEditEnvelope={() => setEditingEnvelope(true)}
                        onEntryChanged={onExpenseSaved}
                        month={effectiveMonth}
                        statementCloseDay={envelopeData.card.statement_close_day ?? null}
                        paymentDay={envelopeData.card.payment_day ?? null}
                        categories={envelopeData.categories}
                        cycleState={envelopeData.cycleState}
                        pastPlan={envelopeData.pastPlan}
                      />
                    )}

                    {/* Envelope editor (replaces decision view when open) */}
                    {editingEnvelope && !planLocked && (
                      <CardEnvelopeEditor
                        cardId={envelopeData.card.id}
                        month={effectiveMonth}
                        totalGoal={envelopeData.totalGoal}
                        envelopeItems={envelopeData.envelopeItems}
                        statementCloseDay={envelopeData.card.statement_close_day ?? null}
                        paymentDay={envelopeData.card.payment_day ?? null}
                        categories={envelopeData.categories}
                        locale={locale}
                        onSaved={onEnvelopeSaved}
                        onCancel={() => setEditingEnvelope(false)}
                      />
                    )}

                    {/* Add expense — card entry lives only here now */}
                    <ExpenseForm
                      categories={envelopeData.categories.map((c) => ({ ...c, type: 'expense' }))}
                      accounts={[envelopeData.card]}
                      accountId={envelopeData.card.id}
                      onSaved={onExpenseSaved}
                    />

                    {/* 12-month grid */}
                    {!loadingGrid && gridData && (
                      <CardGrid grid={gridData} locale={locale} />
                    )}
                    {loadingGrid && (
                      <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
                        <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('loading')}</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

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
import { GridData, CategoryEntryLine } from '@/lib/envelopeHelpers';
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
};

export default function CardsPage() {
  const t = useTranslations('cards');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const { month: currentMonth } = useBusinessToday();
  const [cy0, cm0] = currentMonth.split('-').map(Number);

  // A Timeline bridge row deep-links here with ?card=<id>&month=<YYYY-MM> —
  // read once on mount, same pattern as the Timeline page's own ?month=
  // deep link from the dashboard.
  const cardParam = searchParams.get('card');
  const monthParamRaw = searchParams.get('month');
  const monthParam = monthParamRaw && /^\d{4}-\d{2}$/.test(monthParamRaw) ? monthParamRaw : null;

  // Build the month list starting ONE month before the current month, not
  // just forward: a bridge row's spend month (bridge_source_month) is always
  // payment-month − 1, and the payment can land as early as the current
  // month — so the spend month it deep-links to can be one month before
  // "today," which a forward-only list would never contain a tab for.
  const months: { value: string; label: string }[] = [];
  for (let i = -1; i < 12; i++) {
    const d = new Date(cy0, cm0 - 1 + i, 1);
    months.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', year: 'numeric' }),
    });
  }

  const [cards, setCards]               = useState<Account[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth]   = useState(monthParam ?? currentMonth);
  const [envelopeData, setEnvelopeData]     = useState<EnvelopeData | null>(null);
  const [gridData, setGridData]             = useState<GridData | null>(null);
  const [overview, setOverview]             = useState<CardOverviewRow[]>([]);
  const [loadingEnv, setLoadingEnv]         = useState(false);
  const [loadingGrid, setLoadingGrid]       = useState(false);
  const [editingEnvelope, setEditingEnvelope] = useState(false);

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
    fetch(`/api/card-envelope?cardId=${selectedCardId}&month=${selectedMonth}&locale=${locale}`)
      .then(async (r) => {
        if (r.status === 401) { router.push(`/${locale}/signin`); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: EnvelopeData | null) => { if (d) setEnvelopeData(d); })
      .finally(() => setLoadingEnv(false));
  }, [selectedCardId, selectedMonth, router, locale]);

  const loadGrid = useCallback(() => {
    if (!selectedCardId) return;
    setLoadingGrid(true);
    fetch(`/api/card-envelope/grid?cardId=${selectedCardId}&locale=${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GridData | null) => { if (d) setGridData(d); })
      .finally(() => setLoadingGrid(false));
  }, [selectedCardId, locale]);

  const loadOverview = useCallback(() => {
    fetch(`/api/cards/overview?month=${selectedMonth}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cards: CardOverviewRow[] } | null) => { if (d) setOverview(d.cards); })
      .catch(() => {});
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedCardId) return;
    setEnvelopeData(null);
    setGridData(null);
    setEditingEnvelope(false);
    loadEnvelope();
    loadGrid();
  }, [selectedCardId, selectedMonth, loadEnvelope, loadGrid]);

  useEffect(() => {
    if (cards.length === 0) return;
    loadOverview();
  }, [cards, selectedMonth, loadOverview]);

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
                monthLabel={months.find((mo) => mo.value === selectedMonth)?.label ?? selectedMonth}
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

                {/* Month tabs */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {months.map((mo) => (
                    <button
                      key={mo.value}
                      onClick={() => setSelectedMonth(mo.value)}
                      className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-all shrink-0"
                      style={{
                        background: selectedMonth === mo.value ? '#0F2044' : 'white',
                        color: selectedMonth === mo.value ? 'white' : '#6B7280',
                        border: selectedMonth === mo.value ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                      }}
                    >
                      {mo.label}
                    </button>
                  ))}
                </div>

                {loadingEnv && (
                  <p className="text-center py-12 text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>
                )}

                {!loadingEnv && envelopeData && (
                  <>
                    {/* Decision view */}
                    {!editingEnvelope && (
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
                      />
                    )}

                    {/* Envelope editor (replaces decision view when open) */}
                    {editingEnvelope && (
                      <CardEnvelopeEditor
                        cardId={envelopeData.card.id}
                        month={selectedMonth}
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

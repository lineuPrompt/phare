'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import { formatCurrency, formatSignedAmount } from '@/components/expenses/types';
import type { ReconciliationResult, AccountAudit } from '@/lib/reconcileHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

type ReconcileData = ReconciliationResult & { month: string };

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function fmt(amount: number, locale: string) {
  return formatCurrency(Math.abs(amount), locale);
}

function Row({
  label,
  value,
  locale,
  note,
  bold,
  color,
  indent,
}: {
  label: string;
  value: number;
  locale: string;
  note?: string;
  bold?: boolean;
  color?: string;
  indent?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between py-1.5 text-sm"
      style={{ borderBottom: '1px solid #F3F4F6', paddingLeft: indent ? '1rem' : 0 }}
    >
      <span style={{ color: color ?? '#374151', fontWeight: bold ? 600 : 400 }}>
        {label}
        {note && (
          <span className="ml-2 text-xs" style={{ color: '#9CA3AF', fontWeight: 400 }}>
            {note}
          </span>
        )}
      </span>
      <span style={{ color: color ?? '#374151', fontWeight: bold ? 600 : 400 }}>
        {fmt(value, locale)}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '2px solid #D1D5DB', margin: '4px 0' }} />;
}

// ---------------------------------------------------------------------------
// Reconciliation status badge
// ---------------------------------------------------------------------------

function ReconcileStatus({
  reconciled,
  difference,
  locale,
}: {
  reconciled: boolean;
  difference: number;
  locale: string;
}) {
  const t = useTranslations('reconcile');
  if (reconciled) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold"
        style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC', color: '#15803D' }}
      >
        <span className="text-lg">✓</span>
        <span>{t('reconciled')}</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold"
      style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', color: '#B91C1C' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">✗</span>
        <span>{t('mismatch')}</span>
      </div>
      <span className="text-base">
        Δ {difference < 0 ? '−' : '+'}{fmt(difference, locale)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-account audit card
// ---------------------------------------------------------------------------

function AccountCard({ account, locale }: { account: AccountAudit; locale: string }) {
  const t = useTranslations('reconcile');
  const [open, setOpen] = useState(false);

  const typeLabel: Record<string, string> = {
    chequing: t('accountType.chequing'),
    credit_card: t('accountType.creditCard'),
    savings: t('accountType.savings'),
    tfsa: t('accountType.tfsa'),
    rrsp: t('accountType.rrsp'),
  };

  const balanceColor =
    account.accountType === 'chequing'
      ? account.monthBalance >= 0
        ? '#15803D'
        : '#B91C1C'
      : '#374151';

  return (
    <div className="rounded-xl bg-white" style={{ border: '1px solid #E5E7EB' }}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: '#374151', fontWeight: 600 }}>{account.accountName}</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: '#F3F4F6', color: '#6B7280' }}
          >
            {typeLabel[account.accountType] ?? account.accountType}
          </span>
          <span className="text-xs" style={{ color: '#9CA3AF' }}>
            {t('txCount', { count: account.transactions.length })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ color: balanceColor, fontWeight: 600 }}>
            {account.accountType === 'chequing' && account.monthBalance < 0 ? '−' : ''}
            {fmt(account.monthBalance, locale)}
          </span>
          <span style={{ color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {account.transactions.length === 0 ? (
            <p className="text-xs py-2" style={{ color: '#9CA3AF' }}>{t('noTransactions')}</p>
          ) : (
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #F3F4F6' }}>
                  <th className="text-left py-1.5 font-medium">{t('table.date')}</th>
                  <th className="text-left py-1.5 font-medium">{t('table.description')}</th>
                  <th className="text-left py-1.5 font-medium">{t('table.category')}</th>
                  <th className="text-left py-1.5 font-medium">{t('table.type')}</th>
                  <th className="text-right py-1.5 font-medium">{t('table.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {account.transactions.map((tx) => {
                  const signed = formatSignedAmount(tx.amount, tx.type, locale);
                  return (
                    <tr
                      key={tx.id}
                      style={{
                        borderBottom: '1px solid #F9FAFB',
                        background: tx.isBridge ? '#FFFBEB' : 'transparent',
                      }}
                    >
                      <td className="py-1.5" style={{ color: '#6B7280' }}>{tx.date}</td>
                      <td className="py-1.5" style={{ color: '#374151' }}>
                        {tx.description ?? '—'}
                        {tx.installmentLabel && (
                          <span
                            className="ml-1.5 text-xs px-1.5 py-0.5 rounded"
                            style={{ background: '#F0FDFD', color: '#2ABFBF' }}
                          >
                            {tx.installmentLabel}
                          </span>
                        )}
                        {tx.isBridge && (
                          <span
                            className="ml-1 text-xs px-1 rounded"
                            style={{ background: '#FEF3C7', color: '#92400E' }}
                          >
                            {t('bridgeBadge')}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5" style={{ color: tx.categoryName ? '#6B7280' : '#D1D5DB' }}>
                        {tx.categoryName ?? '—'}
                      </td>
                      <td className="py-1.5" style={{ color: '#6B7280' }}>{t(`type.${tx.type}`)}</td>
                      <td className="py-1.5 text-right font-medium" style={{ color: signed.color }}>
                        {signed.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month picker — only months with any transaction, plus always the current
// month (see GET /api/reconcile/months).
// ---------------------------------------------------------------------------

function monthLabel(value: string, locale: string) {
  return new Date(value + '-01T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReconcilePage() {
  const t = useTranslations('reconcile');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const { month: currentMonth } = useBusinessToday();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [data, setData] = useState<ReconcileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/reconcile/months')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { months: string[] } | null) => { if (d) setMonths(d.months); })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/reconcile?month=${selectedMonth}`)
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        const json = await res.json();
        if (json.error) { setError(json.error); return null; }
        return json as ReconcileData;
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => setError(t('loadError')))
      .finally(() => setLoading(false));
  }, [selectedMonth, router, locale, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">

            <div>
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>
                {t('title')}
              </h1>
              <p className="mt-1 text-sm" style={{ color: '#6B7280' }}>
                {t('subtitle')}
              </p>
            </div>

            {/* Month selector — only months with data, plus always the current month */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {months.map((mo) => (
                <button
                  key={mo}
                  onClick={() => setSelectedMonth(mo)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-all shrink-0"
                  style={{
                    background: selectedMonth === mo ? '#0F2044' : 'white',
                    color: selectedMonth === mo ? 'white' : '#6B7280',
                    border: selectedMonth === mo ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                  }}
                >
                  {monthLabel(mo, locale)}
                </button>
              ))}
            </div>

            {loading && (
              <p className="text-center py-12 text-sm" style={{ color: '#6B7280' }}>
                {t('loading')}
              </p>
            )}

            {!loading && error && (
              <div
                className="px-4 py-3 rounded-xl text-sm"
                style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}
              >
                {error}
              </div>
            )}

            {!loading && data && !error && (
              <>
                {/* Reconciliation status */}
                <ReconcileStatus
                  reconciled={data.reconciled}
                  difference={data.netDifference}
                  locale={locale}
                />

                {/* Bucket breakdown + dual-net comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: bucket breakdown */}
                  <div
                    className="rounded-2xl bg-white p-5"
                    style={{ border: '1px solid #E5E7EB' }}
                  >
                    <h2
                      className="text-xs font-semibold uppercase tracking-wide mb-3"
                      style={{ color: '#6B7280' }}
                    >
                      {t('bucketBreakdown.title')}
                    </h2>
                    <Row label={t('bucketBreakdown.income')} value={data.totalIncome} locale={locale} color="#16A34A" bold />
                    <Row
                      label={t('bucketBreakdown.expenses')}
                      value={data.totalExpenses}
                      locale={locale}
                      note={t('bucketBreakdown.includesBridge')}
                      color="#DC2626"
                    />
                    <Row
                      label={t('bucketBreakdown.cardPayments')}
                      value={data.totalBridgePayments}
                      locale={locale}
                      indent
                      color="#9A3412"
                    />
                    <Row label={t('bucketBreakdown.savingsTransfers')} value={data.totalSavings} locale={locale} color="#2563EB" />
                    <Divider />
                    <Row label={t('bucketBreakdown.netFromBuckets')} value={data.netFromBuckets} locale={locale} bold />
                  </div>

                  {/* Right: dual-net comparison */}
                  <div
                    className="rounded-2xl bg-white p-5"
                    style={{ border: '1px solid #E5E7EB' }}
                  >
                    <h2
                      className="text-xs font-semibold uppercase tracking-wide mb-3"
                      style={{ color: '#6B7280' }}
                    >
                      {t('dualNet.title')}
                    </h2>
                    <Row label={t('bucketBreakdown.netFromBuckets')} value={data.netFromBuckets} locale={locale} bold />
                    <Row
                      label={t('dualNet.netFromChequing')}
                      value={data.netFromChequing}
                      locale={locale}
                      note={t('dualNet.pathTwo')}
                      bold
                    />
                    <Divider />
                    <div className="flex items-center justify-between py-2 text-sm">
                      <span
                        style={{
                          color: data.reconciled ? '#15803D' : '#B91C1C',
                          fontWeight: 600,
                        }}
                      >
                        {data.reconciled ? `✓ ${t('dualNet.match')}` : `✗ ${t('dualNet.mismatchShort')}`}
                      </span>
                      {!data.reconciled && (
                        <span
                          style={{ color: '#B91C1C', fontWeight: 700, fontSize: '1rem' }}
                        >
                          Δ {data.netDifference < 0 ? '−' : '+'}
                          {fmt(data.netDifference, locale)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
                      {t('dualNet.footnote')}
                    </p>
                  </div>
                </div>

                {/* Per-account audit */}
                <div>
                  <h2
                    className="text-xs font-semibold uppercase tracking-wide mb-3"
                    style={{ color: '#6B7280' }}
                  >
                    {t('perAccount.title')}
                  </h2>
                  <div className="space-y-2">
                    {data.accounts.length === 0 ? (
                      <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('perAccount.empty')}</p>
                    ) : (
                      data.accounts.map((account) => (
                        <AccountCard key={account.accountId} account={account} locale={locale} />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { classifyDip, type DipInfo } from '@/lib/timelineHelpers';
import { formatCurrency } from '@/components/expenses/types';

function fmtDay(iso: string, locale: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'long',
  });
}

/**
 * The tile is TODAY-ANCHORED, not month-scoped — it sits beside "Balance
 * today" and does not change when the ledger below navigates to another
 * month. That was invisible while the label read only "Lowest point": above
 * an October ledger it read as October's low, when it is in fact the low
 * between today and the next payday. Naming the payday date (2026-09-03)
 * makes the window self-evident wherever the tile is read. The month's own
 * low now lives in DayLedger's month strip, which does follow navigation.
 *
 * Colour comes from classifyDip, the shared tier helper, rather than an
 * inline `balance < 0` test. The inline version had no amber tier at all, so
 * a low but positive dip looked identical to a comfortable one.
 */
export default function TimelineHeader({
  todayBalance,
  dip,
  nextIncomeDate,
  locale,
}: {
  todayBalance: number | null;
  dip: DipInfo | null;
  /** The payday the dip window ends on. null only when dip is null. */
  nextIncomeDate: string | null;
  locale: string;
}) {
  const t = useTranslations('timeline.header');

  const status = classifyDip(dip);

  const palette = {
    none:    { bg: '#F9FAFB', border: 'transparent', text: '#6B7280' },
    healthy: { bg: '#F0FDFD', border: 'transparent', text: '#0F2044' },
    amber:   { bg: '#FFFBEB', border: '#FDE68A',     text: '#92400E' },
    red:     { bg: '#FEF2F2', border: '#DC2626',     text: '#DC2626' },
  }[status];

  // Only shown when there IS a dip, so nextIncomeDate is present alongside it.
  const payday = nextIncomeDate ? fmtDay(nextIncomeDate, locale) : '';

  return (
    <div className="rounded-2xl bg-white p-6 flex flex-col sm:flex-row sm:items-center gap-4" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: '#6B7280' }}>{t('balanceToday')}</p>
        <p className="text-3xl font-bold" style={{ color: '#0F2044' }}>
          {todayBalance !== null ? formatCurrency(todayBalance, locale) : '—'}
        </p>
      </div>

      <div
        className="flex-1 rounded-xl px-4 py-3"
        style={{
          background: palette.bg,
          border: palette.border === 'transparent' ? '1px solid transparent' : `1.5px solid ${palette.border}`,
        }}
      >
        {dip === null && (
          <p className="text-sm" style={{ color: palette.text }}>{t('noDip')}</p>
        )}
        {dip !== null && status !== 'red' && (
          <p className="text-sm" style={{ color: palette.text }}>
            {t('lowestBeforePay', { payday })}{' '}
            <strong>{formatCurrency(dip.balance, locale)} {t('on')} {fmtDay(dip.date, locale)}</strong>
          </p>
        )}
        {dip !== null && status === 'red' && (
          <p className="text-sm font-semibold" style={{ color: palette.text }}>
            {t('dipsBelowZeroBeforePay', { payday })}{' '}
            {formatCurrency(dip.balance, locale)} {t('on')} {fmtDay(dip.date, locale)}
          </p>
        )}
      </div>
    </div>
  );
}

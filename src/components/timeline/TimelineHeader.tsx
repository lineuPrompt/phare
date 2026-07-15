'use client';

import { useTranslations } from 'next-intl';
import type { DipInfo } from '@/lib/timelineHelpers';
import { formatCurrency } from '@/components/expenses/types';

function fmtDay(iso: string, locale: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'long',
  });
}

export default function TimelineHeader({
  todayBalance,
  dip,
  windowEndDate,
  locale,
}: {
  todayBalance: number | null;
  dip: DipInfo | null;
  windowEndDate: string;
  locale: string;
}) {
  const t = useTranslations('timeline.header');

  const dipNegative = dip !== null && dip.balance < 0;

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
          background: dip === null ? '#F9FAFB' : dipNegative ? '#FEF2F2' : '#F0FDFD',
          border: dipNegative ? '1.5px solid #DC2626' : '1px solid transparent',
        }}
      >
        {dip === null && (
          <p className="text-sm" style={{ color: '#6B7280' }}>
            {t('noDip', { date: fmtDay(windowEndDate, locale) })}
          </p>
        )}
        {dip !== null && !dipNegative && (
          <p className="text-sm" style={{ color: '#0F2044' }}>
            {t('lowestPoint')}: <strong>{formatCurrency(dip.balance, locale)} {t('on')} {fmtDay(dip.date, locale)}</strong>
          </p>
        )}
        {dip !== null && dipNegative && (
          <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>
            {t('dipsBelowZero')}: {formatCurrency(dip.balance, locale)} {t('on')} {fmtDay(dip.date, locale)}
          </p>
        )}
      </div>
    </div>
  );
}

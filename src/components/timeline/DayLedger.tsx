'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { RefObject } from 'react';
import type { MonthView } from '@/lib/timelineDisplayHelpers';
import type { TimelineEntry, TimelineTx } from '@/lib/timelineHelpers';
import { formatCurrency, formatSignedAmount } from '@/components/expenses/types';

function fmtDay(iso: string, locale: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function sourceHref(
  entry: { isBridge: boolean; recurringItemId: string | null; transferPeerId: string | null },
  locale: string
): string {
  if (entry.isBridge) return `/${locale}/cards`;
  if (entry.recurringItemId) return `/${locale}/recurring`;
  if (entry.transferPeerId) return `/${locale}/goals`;
  // One-off entries have no editable home post-consolidation (Expenses is
  // retired; Timeline's own ledger is read-only) — Audit is where they can
  // still be traced.
  return `/${locale}/reconcile`;
}

function EntryRow({ entry, locale, muted }: { entry: TimelineTx & { isFuture?: boolean }; locale: string; muted: boolean }) {
  const t = useTranslations('timeline.list');
  const signed = formatSignedAmount(entry.amount, entry.type, locale);
  const isFuture = entry.isFuture === true;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Link
        href={sourceHref(entry, locale)}
        className="flex-1 min-w-0 truncate text-sm hover:underline"
        style={{ color: muted ? '#9CA3AF' : isFuture ? '#6B7280' : '#0F2044' }}
      >
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
    </div>
  );
}

export default function DayLedger({
  monthView,
  today,
  locale,
  todayRef,
}: {
  monthView: MonthView;
  today: string;
  locale: string;
  todayRef?: RefObject<HTMLDivElement | null>;
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
                <EntryRow key={entry.id} entry={entry} locale={locale} muted />
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
                <span className="text-sm font-bold" style={{ color: day.isNegative ? '#DC2626' : '#0F2044' }}>
                  {formatCurrency(day.endOfDayBalance, locale)}
                </span>
              </div>
              {(day.entries as TimelineEntry[]).map((entry) => (
                <EntryRow key={entry.id} entry={entry} locale={locale} muted={false} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

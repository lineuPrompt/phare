'use client';

import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/expenses/types';
import { EnvelopeStatus } from '@/lib/envelopeHelpers';

export type CardOverviewRow = {
  id: string;
  name: string;
  goal: number | null;
  spent: number;
  remaining: number | null;
  status: EnvelopeStatus;
};

// The missing third question: which card has room, without opening any
// card. Reads the same shared envelopeStatus/totalSpendForCard math every
// other card surface uses — cards stay in creation order (already sorted
// by the API), never alphabetical.
export default function CrossCardView({
  cards,
  monthLabel,
  locale,
}: {
  cards: CardOverviewRow[];
  monthLabel: string;
  locale: string;
}) {
  const t = useTranslations('cards.overview');
  if (cards.length === 0) return null;

  const statusColor = (status: EnvelopeStatus) => {
    if (status === 'over') return '#DC2626';
    if (status === 'watch') return '#D97706';
    if (status === 'ok') return '#16A34A';
    return '#9CA3AF';
  };
  const statusLabel = (status: EnvelopeStatus) => {
    if (status === 'over') return t('over');
    if (status === 'watch') return t('watch');
    if (status === 'ok') return t('ok');
    return t('noGoal');
  };

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold" style={{ color: '#0F2044' }}>{t('title')}</h3>
        <span className="text-xs" style={{ color: '#6B7280' }}>{monthLabel}</span>
      </div>
      <div className="space-y-2">
        {cards.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 px-3 rounded-xl" style={{ background: '#FAFAF8' }}>
            <span className="flex-1 min-w-[120px] text-sm font-medium truncate" style={{ color: '#0F2044' }}>💳 {c.name}</span>
            <span className="text-xs w-32 text-right shrink-0" style={{ color: '#6B7280' }}>
              {t('goal')}: {c.goal !== null ? formatCurrency(c.goal, locale) : '—'}
            </span>
            <span className="text-xs w-32 text-right shrink-0" style={{ color: '#0F2044' }}>
              {t('spent')}: {formatCurrency(c.spent, locale)}
            </span>
            <span
              className="text-xs w-32 text-right shrink-0 font-semibold"
              style={{ color: c.remaining !== null && c.remaining < 0 ? '#DC2626' : '#0F2044' }}
            >
              {t('room')}: {c.remaining !== null ? formatCurrency(c.remaining, locale) : '—'}
            </span>
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full shrink-0"
              style={{ background: statusColor(c.status) + '22', color: statusColor(c.status) }}
            >
              {statusLabel(c.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

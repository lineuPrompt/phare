import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CardCycleRemainder } from '@/lib/projectionHelpers';
import { formatCurrency } from './types';

// The app's first forward-looking estimate — deliberately styled unlike
// DipTile/SnapshotCard (never green/red healthy-vs-danger) and explicitly
// labeled a projection so it can never be mistaken for a real balance.
//
// LABELING: this is a RUNNING BALANCE (carries forward whatever was already
// in the account), unlike the Snapshot card's "Monthly surplus" (this
// month's income − expenses only, never carries a prior balance). Shown
// side by side on the dashboard, the two numbers can look like they
// contradict each other if a reader doesn't know they answer different
// questions — so this tile states its own basis explicitly (`basis` copy,
// naming the carried-in amount) rather than assuming that's obvious.
export default function ProjectedBalanceTile({
  projectedMonthEnd,
  carriedInAmount,
  remainders,
  locale,
}: {
  projectedMonthEnd: number;
  carriedInAmount: number;
  remainders: CardCycleRemainder[];
  locale: string;
}) {
  const t = useTranslations('dashboard.projectedTile');

  // Only a card with NEITHER a budget NOR any real recorded spend this cycle
  // is genuinely excluded — one with real spending (even unbudgeted) is
  // already counted via `payment` and must never be listed here.
  const noDataNames = remainders.filter((r) => r.noData).map((r) => r.cardName);

  return (
    <div className="rounded-2xl p-6" style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
      <span
        className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
        style={{ background: '#EDE9FE', color: '#6D28D9' }}
      >
        {t('badge')}
      </span>
      <p className="text-sm mb-1" style={{ color: '#6B7280' }}>{t('label')}</p>
      <p className="text-2xl font-bold" style={{ color: '#4C1D95' }}>
        {formatCurrency(projectedMonthEnd, locale)}
      </p>

      <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
        {t('basis', { amount: formatCurrency(carriedInAmount, locale) })}
      </p>

      {noDataNames.length > 0 && (
        <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
          {t('unbudgeted', { cards: noDataNames.join(', ') })}
        </p>
      )}

      <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
        {t('note')}{' '}
        <Link href={`/${locale}/timeline`} className="underline hover:no-underline">
          {t('viewRealBalance')}
        </Link>
      </p>
    </div>
  );
}

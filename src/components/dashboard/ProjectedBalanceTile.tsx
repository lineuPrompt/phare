import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CardCycleRemainder } from '@/lib/projectionHelpers';
import { formatCurrency } from './types';

// The app's first forward-looking estimate — deliberately styled unlike
// DipTile/SnapshotCard (never green/red healthy-vs-danger) and explicitly
// labeled a projection so it can never be mistaken for a real balance.
export default function ProjectedBalanceTile({
  projectedMonthEnd,
  remainders,
  locale,
}: {
  projectedMonthEnd: number;
  remainders: CardCycleRemainder[];
  locale: string;
}) {
  const t = useTranslations('dashboard.projectedTile');

  const unbudgetedNames = remainders.filter((r) => r.unbudgeted).map((r) => r.cardName);

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

      {unbudgetedNames.length > 0 && (
        <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
          {t('unbudgeted', { cards: unbudgetedNames.join(', ') })}
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

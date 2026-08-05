import { useTranslations } from 'next-intl';
import { formatDate } from './types';
import UpgradeButton from '@/components/billing/UpgradeButton';

/**
 * The monthly review.
 *
 * `locked` is PRESENTATION ONLY. By the time this renders, a free household's
 * `review` prop already contains nothing but the preview — the rest of the text
 * was dropped server-side in the dashboard route and is not in the payload.
 * This component cannot leak what it was never given, and deleting the lock UI
 * would reveal nothing.
 */
export default function ReviewCard({
  review,
  date,
  locale,
  locked = false,
}: {
  review: string;
  date: string | null;
  locale: string;
  locked?: boolean;
}) {
  const t = useTranslations('dashboard');

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #2ABFBF' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold" style={{ color: '#0F2044' }}>
          {t('review')}
        </h2>
        {date && (
          <p className="text-sm" style={{ color: '#6B7280' }}>
            {t('reviewDate', { date: formatDate(date, locale) })}
          </p>
        )}
      </div>

      <div style={{ color: '#374151' }}>
        {review.split('\n').filter(Boolean).map((paragraph, i) => (
          <p key={i} className="mb-4">{paragraph}</p>
        ))}
      </div>

      {locked && (
        <div
          className="rounded-xl p-5 mt-2"
          style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}
        >
          <p className="font-semibold text-sm mb-1" style={{ color: '#0F766E' }}>
            {t('reviewLockedTitle')}
          </p>
          <p className="text-sm mb-4" style={{ color: '#0F766E' }}>
            {t('reviewLockedBody')}
          </p>
          {/* The real entry point. This used to link to /#pricing, where the
              CTA is an inert div — a paywall that could not be paid. */}
          <UpgradeButton />
        </div>
      )}
    </div>
  );
}

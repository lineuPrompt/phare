import { useTranslations } from 'next-intl';
import { formatDate } from './types';

export default function ReviewCard({ review, date, locale }: { review: string; date: string | null; locale: string }) {
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
    </div>
  );
}
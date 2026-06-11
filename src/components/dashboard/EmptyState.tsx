import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function EmptyState({ locale }: { locale: string }) {
  const t = useTranslations('dashboard');

  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="text-5xl mb-6">🗺️</div>
      <p className="text-xl font-semibold mb-6" style={{ color: '#0F2044' }}>
        {t('noPlan')}
      </p>
      <Link
        href={`/${locale}/upload`}
        className="inline-block px-8 py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all"
        style={{ background: '#0F2044' }}
      >
        {t('noPlanCta')}
      </Link>
    </div>
  );
}
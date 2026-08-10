'use client';

// The Reviews archive — every letter Phare has written this household, oldest
// commitment first: the monthly letters by month, then anything unmonthed, then
// the starting plan.
//
// A shell only, matching /savings: the section owns its own fetch, state and
// loading/error handling. Nothing is computed here.

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import ReviewsList from '@/components/reviews/ReviewsList';

export default function ReviewsPage() {
  const t = useTranslations('reviews');
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
            <div>
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
              <p className="text-sm mt-2" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
            </div>
            <ReviewsList locale={locale} />
          </div>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/brand/Navbar';
import TopPriorityCard from '@/components/dashboard/TopPriorityCard';
import SnapshotCard from '@/components/dashboard/SnapshotCard';
import SinkingFundsCard from '@/components/dashboard/SinkingFundsCard';
import GoalsCard from '@/components/dashboard/GoalsCard';
import ReviewCard from '@/components/dashboard/ReviewCard';
import EmptyState from '@/components/dashboard/EmptyState';
import { DashboardData } from '@/components/dashboard/types';
import Sidebar from '@/components/dashboard/Sidebar';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(async (res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [router, locale]);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="text-4xl mb-4 animate-pulse">🏠</div>
          <p style={{ color: '#6B7280' }}>{t('loading')}</p>
        </div>
      </main>
    );
  }

  if (!data?.hasPlan) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <EmptyState locale={locale} />
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex">
        <Sidebar locale={locale} />

        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>
              {t('welcome', { name: data.firstName || '' })}
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {data.topRecommendation && <TopPriorityCard text={data.topRecommendation} />}
              {data.summary && <SnapshotCard summary={data.summary} locale={locale} />}
              {data.goalAccounts !== undefined && (
                <GoalsCard goals={data.goalAccounts} locale={locale} />
              )}
              {data.sinkingFunds && <SinkingFundsCard funds={data.sinkingFunds} locale={locale} />}
            </div>

            {data.review && <ReviewCard review={data.review} date={data.reviewDate ?? null} locale={locale} />}
          </div>
        </div>
      </div>
    </main>
  );
}

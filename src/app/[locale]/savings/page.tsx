'use client';

// Savings & Reserves (2026-08-08) — the merged home for everything the
// household sets aside each month. Reserve Fund first (money for bills that
// are already coming), Goals below (money for something you want); the
// ordering carries that distinction.
//
// This route is a shell only. Each section owns its own fetch, its own state
// and its own loading/error handling, so they render independently as their
// requests land and neither can block the other. No combined figure is
// computed here — the two sections are presented together, not merged.

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import ReserveFundSection from '@/components/savings/ReserveFundSection';
import GoalsSection from '@/components/savings/GoalsSection';

export default function SavingsPage() {
  const t = useTranslations('savings');
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
            <ReserveFundSection locale={locale} />
            <GoalsSection locale={locale} />
          </div>
        </div>
      </div>
    </main>
  );
}

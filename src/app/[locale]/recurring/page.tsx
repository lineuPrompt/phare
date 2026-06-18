'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import RecurringForm from '@/components/recurring/RecurringForm';
import RecurringList from '@/components/recurring/RecurringList';
import { RecurringAccount, RecurringItem } from '@/components/recurring/types';

export default function RecurringPage() {
  const t = useTranslations('recurring');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [items, setItems] = useState<RecurringItem[]>([]);
  const [accounts, setAccounts] = useState<RecurringAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/recurring')
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        return res.json();
      })
      .then((d) => {
        if (d) {
          setItems(d.items);
          setAccounts(d.accounts ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [router, locale]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
            <div>
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
              <p className="mt-1" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
            </div>

            <RecurringForm accounts={accounts} onSaved={load} />

            {loading
              ? <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
              : <RecurringList items={items} accounts={accounts} locale={locale} onChanged={load} />}
          </div>
        </div>
      </div>
    </main>
  );
}

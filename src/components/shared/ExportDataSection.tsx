'use client';

import { useTranslations } from 'next-intl';
import { useTransactionExport } from '@/components/shared/useTransactionExport';

/**
 * "Export your data" — downloads the household's transactions as CSV.
 *
 * The download itself lives in useTransactionExport, because the deletion flow
 * offers the same export as its primary action and the two must not drift.
 */
export default function ExportDataSection({ locale }: { locale: string }) {
  const t = useTranslations('exportData');
  const { download, downloading, error } = useTransactionExport(locale);

  return (
    <section className="rounded-2xl bg-white p-6 space-y-3" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('title')}</h2>
      <p className="text-sm" style={{ color: '#6B7280' }}>{t('description')}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={download}
        disabled={downloading}
        className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all disabled:opacity-50"
        style={{ border: '1.5px solid #0F2044', color: '#0F2044' }}
      >
        {downloading ? t('preparing') : t('button')}
      </button>
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * "Export your data" — downloads the household's transactions as CSV.
 *
 * Fetches rather than using a plain <a href>: the endpoint is authenticated
 * and can fail (401, query error), and a bare link would navigate the family
 * to a raw JSON error page instead of telling them something went wrong. The
 * blob round-trip keeps the failure inside this component.
 */
export default function ExportDataSection({ locale }: { locale: string }) {
  const t = useTranslations('exportData');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setDownloading(true);
    setError('');

    try {
      const res = await fetch(`/api/export/transactions?locale=${locale}`);
      if (!res.ok) throw new Error(String(res.status));

      const blob = await res.blob();

      // Prefer the filename the server chose so the date in it is the
      // server's, not a second opinion from the browser's clock.
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = match?.[1] ?? 'phare-transactions.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-6 space-y-3" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('title')}</h2>
      <p className="text-sm" style={{ color: '#6B7280' }}>{t('description')}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleExport}
        disabled={downloading}
        className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all disabled:opacity-50"
        style={{ border: '1.5px solid #0F2044', color: '#0F2044' }}
      >
        {downloading ? t('preparing') : t('button')}
      </button>
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The CSV export download, extracted so more than one surface can offer it.
 *
 * It exists as a hook because the deletion flow needs the SAME download as the
 * ordinary "Export your data" card but rendered as its primary action — and a
 * second copy of this logic is exactly the kind of drift that ends with one of
 * them silently broken. The one place a family is most likely to need their
 * data is the screen where they are about to destroy it.
 *
 * Fetches rather than using a plain <a href>: the endpoint is authenticated and
 * can fail, and a bare link would navigate the family to a raw JSON error page.
 */
export function useTransactionExport(locale: string) {
  const t = useTranslations('exportData');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);

  const download = async () => {
    setDownloading(true);
    setError('');

    try {
      const res = await fetch(`/api/export/transactions?locale=${locale}`);

      if (!res.ok) {
        // Show the server's actual reason. A generic "please try again" hid a
        // PostgREST embed error through a whole build-and-ship cycle — neither
        // the family nor whoever they email can act on a message that omits
        // why. The localized string is only the fallback for a body we can't
        // read (network drop, non-JSON response).
        const reason = await res
          .json()
          .then((body) => body?.error as string | undefined)
          .catch(() => undefined);
        setError(reason ?? t('failed'));
        return;
      }

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
      setDownloaded(true);
    } catch {
      setError(t('failed'));
    } finally {
      setDownloading(false);
    }
  };

  return { download, downloading, downloaded, error };
}

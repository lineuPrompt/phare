import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DipInfo } from '@/lib/timelineHelpers';
import { classifyDip } from '@/lib/timelineHelpers';
import { formatCurrency } from './types';

// Build 3 Phase 4 — the dashboard's own read of the SAME dip value
// buildCashTimeline computes for the Timeline page (fetched from the same
// /api/timeline response, never recomputed here). This is the flagship
// number the family lands on every morning: "is there enough cash to make
// it to the next paycheque."
const STATUS_COLORS: Record<'healthy' | 'amber' | 'red', { bg: string; text: string; border?: string }> = {
  healthy: { bg: '#F0FDF4', text: '#15803D' },
  amber:   { bg: '#FFFBEB', text: '#B45309' },
  red:     { bg: '#FEF2F2', text: '#DC2626', border: '1.5px solid #DC2626' },
};

function fmtDay(iso: string, locale: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'long',
  });
}

export default function DipTile({
  dip,
  windowEndDate,
  locale,
}: {
  dip: DipInfo | null;
  windowEndDate: string;
  locale: string;
}) {
  const t = useTranslations('dashboard.dipTile');
  const status = classifyDip(dip);

  const colors = status === 'none' ? { bg: '#F9FAFB', text: '#6B7280' } : STATUS_COLORS[status];

  return (
    <Link
      href={`/${locale}/timeline`}
      className="block rounded-2xl p-6 hover:opacity-90 transition-opacity"
      style={{ background: colors.bg, border: (colors as { border?: string }).border ?? '1px solid #E5E7EB' }}
    >
      <p className="text-sm font-medium mb-1" style={{ color: '#6B7280' }}>{t('title')}</p>
      {status === 'none' && (
        <p className="text-sm" style={{ color: colors.text }}>{t('noDip', { date: fmtDay(windowEndDate, locale) })}</p>
      )}
      {status === 'red' && dip && (
        <p className="text-xl font-bold" style={{ color: colors.text }}>
          {t('dipsBelow', { amount: formatCurrency(dip.balance, locale), date: fmtDay(dip.date, locale) })}
        </p>
      )}
      {(status === 'healthy' || status === 'amber') && dip && (
        <p className="text-xl font-bold" style={{ color: colors.text }}>
          {t('amountOn', { amount: formatCurrency(dip.balance, locale), date: fmtDay(dip.date, locale) })}
        </p>
      )}
    </Link>
  );
}

import { useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * Shown on the dashboard when the household has no chequing balance anchor.
 *
 * WHY THIS EXISTS. Without an anchor, /api/timeline refuses with
 * { ok: false, reason: 'no_anchor' }, so carriedInAmount, realCloseAmount and
 * planMonth are all null and PlanChainTile returns null — the entire
 * forward-looking projection simply vanished from the page, with no message
 * and nothing to click. The dashboard already knew (it set hasAnchor) and did
 * nothing with it. A missing number the user can supply must ASK, not hide.
 *
 * Deliberately a prompt with a link rather than an inline form: the anchor
 * form already lives on Timeline, where the result is immediately visible in
 * context. Duplicating it here would give the same number two homes.
 */
export default function AnchorPromptCard({ locale }: { locale: string }) {
  const t = useTranslations('dashboard.anchorPrompt');

  return (
    <div className="rounded-2xl p-6" style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}>
      <p className="font-semibold mb-1" style={{ color: '#0F766E' }}>{t('title')}</p>
      <p className="text-sm mb-4" style={{ color: '#0F766E' }}>{t('body')}</p>
      <Link
        href={`/${locale}/timeline`}
        className="inline-block px-5 py-2.5 rounded-full text-sm font-semibold cursor-pointer hover:opacity-90 transition-all"
        style={{ background: '#0F2044', color: 'white' }}
      >
        {t('cta')}
      </Link>
    </div>
  );
}

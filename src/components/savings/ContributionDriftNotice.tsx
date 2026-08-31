'use client';

// Says out loud that the upcoming rows disagree with the rule above them
// (2026-08-31). Before this, the goal card printed the rule amount as its
// headline over a list of hand-edited rows showing something else entirely,
// and gave no hint the two were different numbers from different tables.
//
// It states the disagreement and points at the rule editor as the fix. It
// does NOT offer to "correct" the rows: rewriting rows to match a rule is
// how history gets destroyed, and the honest repair — change the rule,
// forward-dated — is the button already sitting beside this notice.

import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/dashboard/types';
import type { ContributionDrift } from '@/lib/contributionDrift';

export default function ContributionDriftNotice({
  drift,
  locale,
}: {
  drift: ContributionDrift;
  locale: string;
}) {
  const t = useTranslations('contributionEditor');

  // Usually exactly one differing amount (every upcoming row edited to the
  // same figure). Listed rather than summarised so the household recognises
  // the number they typed.
  const amounts = drift.amounts.map((a) => formatCurrency(a, locale)).join(', ');

  return (
    <div className="rounded-xl p-3 space-y-1" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
      <p className="text-sm font-semibold" style={{ color: '#92400E' }}>{t('driftTitle')}</p>
      <p className="text-xs" style={{ color: '#92400E' }}>
        {t('driftBody', {
          count: drift.count,
          amounts,
          ruleAmount: formatCurrency(drift.ruleAmount, locale),
        })}
      </p>
      <p className="text-xs" style={{ color: '#92400E' }}>{t('driftFix')}</p>
    </div>
  );
}

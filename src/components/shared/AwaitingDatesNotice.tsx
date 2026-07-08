'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * "N income sources and M bills awaiting pay dates — not yet in this
 * month's ledger", linking to the Recurring page. Each count is
 * independently pluralized and omitted entirely when zero — this is the
 * one place that composes the sentence, used by the dashboard snapshot,
 * the onboarding plan review, and the Expenses page, so all three stay
 * honest about BOTH income and expenses instead of just income.
 */
export default function AwaitingDatesNotice({
  incomeCount,
  expenseCount,
  href,
  className,
  style,
}: {
  incomeCount: number;
  expenseCount: number;
  href: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslations('awaitingDates');

  if (incomeCount <= 0 && expenseCount <= 0) return null;

  const parts: string[] = [];
  if (incomeCount > 0) parts.push(t('income', { count: incomeCount }));
  if (expenseCount > 0) parts.push(t('bills', { count: expenseCount }));
  const joined = parts.length === 2 ? `${parts[0]} ${t('and')} ${parts[1]}` : parts[0];

  return (
    <Link href={href} className={className} style={style}>
      {joined} {t('suffix')}
    </Link>
  );
}

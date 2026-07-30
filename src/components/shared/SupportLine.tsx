'use client';

import { useTranslations } from 'next-intl';

export const SUPPORT_EMAIL = 'support@phare.money';

/**
 * "Need help? support@phare.money" — the one line shown where someone is
 * blocked and has no self-service next step.
 *
 * Deliberately a plain mailto and nothing else: inbound is handled outside the
 * app (Namecheap forwarding to the founder's inbox), so there is no form, no
 * widget, and no ticket id to show. Factored into one component so the address
 * lives in exactly one place in the UI — if it ever changes, it changes here.
 *
 * Callers pass their own className/style so the line inherits whatever error
 * panel it sits in rather than introducing a look of its own.
 */
export default function SupportLine({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslations('support');

  return (
    <p className={className ?? 'text-sm'} style={{ color: '#6B7280', ...style }}>
      {t('needHelp')}{' '}
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="underline"
        style={{ color: '#2ABFBF' }}
      >
        {SUPPORT_EMAIL}
      </a>
    </p>
  );
}

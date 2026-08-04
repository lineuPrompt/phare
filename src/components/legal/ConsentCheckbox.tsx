'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * The consent gate shown on BOTH signup paths — the signup form and
 * /set-password. Invited members never see the signup form, so a checkbox that
 * lives only there would let a spouse use Phare having agreed to nothing.
 *
 * The label is one rich message rather than glued-together fragments, because
 * "I agree to the X and the Y" does not survive translation as three separate
 * strings — French reorders it and inflects the articles.
 *
 * The links open in a new tab on purpose: clicking through to read the terms
 * must never discard a half-filled signup form, and on /set-password it would
 * drop the recovery session entirely, leaving the invitee unable to finish.
 */
export default function ConsentCheckbox({
  checked,
  onChange,
  locale,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  locale: string;
  disabled?: boolean;
}) {
  const t = useTranslations('legal');

  // Written as a plain JSX-returning helper rather than a factory that returns
  // an arrow component — the latter reads as an anonymous component to
  // react/display-name, which is a lint error for a function that is really
  // just a formatter callback.
  function link(href: string, chunks: React.ReactNode) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        style={{ color: '#0F2044' }}
      >
        {chunks}
      </Link>
    );
  }

  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: '#374151' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 cursor-pointer"
      />
      <span>
        {t.rich('consentCheckbox', {
          terms: (chunks) => link(`/${locale}/terms`, chunks),
          privacy: (chunks) => link(`/${locale}/privacy`, chunks),
        })}
        {/* The AI acknowledgement is deliberately part of the SAME label, not a
            second checkbox. It is not a separate permission to grant — it is
            what the person is confirming they understood when they ticked the
            one box, and splitting it would imply the plan could be used without
            it. */}
        <span className="block mt-1.5 text-xs" style={{ color: '#6B7280' }}>
          {t('consentAiNote')}
        </span>
      </span>
    </label>
  );
}

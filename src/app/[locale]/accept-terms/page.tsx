'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import ConsentCheckbox from '@/components/legal/ConsentCheckbox';
import { CURRENT_LEGAL_VERSION } from '@/lib/legalVersions';

/**
 * The catch-all consent screen.
 *
 * Reached by TermsGuard for anyone signed in who has not accepted the current
 * version. Two populations land here, and the copy distinguishes them:
 *   - users who predate consent entirely (Lineu and Julia, whose rows read
 *     NULL because no backfill was done — inventing a consent that never
 *     happened would have defeated the point of recording one);
 *   - users who accepted an EARLIER version, after CURRENT_LEGAL_VERSION is
 *     bumped for a substantive revision.
 *
 * There is deliberately no "skip" or "later". Consent that can be dismissed is
 * not consent, and the guard would only send them straight back.
 */
export default function AcceptTermsPage() {
  const t = useTranslations('legal');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
  const next = searchParams.get('next') ?? `/${locale}/dashboard`;

  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [previouslyAccepted, setPreviouslyAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled) return;
        if (!me) { router.replace(`/${locale}/signin`); return; }
        // Already current — nothing to ask. Sending them on rather than showing
        // a consent screen they have no reason to see.
        if (me.termsCurrent) { router.replace(next); return; }
        setPreviouslyAccepted(Boolean(me.terms_accepted_at));
        setChecking(false);
      })
      .catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [router, locale, next]);

  const handleAccept = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: CURRENT_LEGAL_VERSION }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // A version_mismatch means this page is stale — the documents changed
        // while it sat open. Reloading is genuinely the fix, not a platitude.
        setError(body?.error ?? t('acceptFailed'));
        return;
      }
      router.replace(next);
    } catch {
      setError(t('acceptFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2 text-center" style={{ color: '#0F2044' }}>
          {previouslyAccepted ? t('acceptTitleUpdated') : t('acceptTitle')}
        </h1>
        <p className="text-center mb-10 text-sm" style={{ color: '#6B7280' }}>
          {previouslyAccepted ? t('acceptBodyUpdated') : t('acceptBodyNew')}
        </p>

        <div className="rounded-2xl bg-white p-8 space-y-5" style={{ border: '1px solid #E5E7EB' }}>
          <ConsentCheckbox checked={consented} onChange={setConsented} locale={locale} disabled={saving} />

          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

          <button
            onClick={handleAccept}
            disabled={!consented || saving}
            className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
            style={{ background: '#0F2044' }}
          >
            {saving ? t('accepting') : t('acceptButton')}
          </button>
        </div>
      </div>
    </main>
  );
}

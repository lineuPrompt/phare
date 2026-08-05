'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import UpgradeButton from '@/components/billing/UpgradeButton';

/**
 * The household's subscription state, and the way out of it.
 *
 * This is what makes the Terms' "cancel at any time from within the app" true —
 * until someone can reach the Customer Portal, that sentence is a promise the
 * product does not keep.
 *
 * FOUR STATES, deliberately distinct:
 *
 *   comped        Pro, no Stripe customer, NO manage button. There is genuinely
 *                 nothing to manage, so a disabled control with a tooltip would
 *                 be worse than none — it implies something is being withheld.
 *                 Says when the comp ends, because that is the one fact they
 *                 need and cannot find anywhere else.
 *
 *   active        Pro and renewing. Manage button.
 *
 *   active_ending Cancelled but still entitled until the period end. THE most
 *                 important one to render: without it someone cancels, returns,
 *                 sees nothing changed, and concludes it failed — so they cancel
 *                 again, email support, or dispute the charge. Naming the date
 *                 prevents all three.
 *
 *   lapsed        Not Pro, but still has a Stripe customer. Keeps the manage
 *                 button for invoice history and resubscribing, AND offers the
 *                 upgrade path.
 *
 * The MANAGE button keys off `hasBillingAccount`, never off isPro — those differ
 * in both directions, which is exactly the comped/lapsed pair above.
 */
type Me = {
  role?: string;
  isPro?: boolean;
  entitlementReason?: string;
  subscriptionPeriodEnd?: string | null;
  compUntil?: string | null;
  hasBillingAccount?: boolean;
};

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export default function SubscriptionSection({ locale }: { locale: string }) {
  const t = useTranslations('billing');
  const searchParams = useSearchParams();
  const justReturned = searchParams.get('portal') === '1';

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  // Only after a Portal return, and BOUNDED. Portal changes arrive through the
  // webhook exactly as checkout's do, so there is a moment where the page can
  // still show the old state. A short settle beats an indefinite spinner: the
  // Portal already showed them the outcome on Stripe's own screen.
  const [settling, setSettling] = useState(justReturned);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      if (res.ok) setMe(await res.json());
    } catch { /* leave previous state; it corrects on the next load */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // Deferred a tick: a synchronous setState inside an effect triggers a
    // cascading render (and the project's lint rule for it). Same behaviour,
    // one microtask later.
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (!justReturned) return;
    // One refetch shortly after returning, then stop. Never a poll loop.
    const t1 = setTimeout(() => { load(); }, 2500);
    const t2 = setTimeout(() => setSettling(false), 10000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [justReturned, load]);

  const openPortal = async () => {
    setOpening(true);
    setError('');
    try {
      const res = await fetch(`/api/stripe/portal?locale=${locale}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) {
        setError(json?.error ?? t('portalFailed'));
        return;
      }
      window.location.href = json.url;
    } catch {
      setError(t('portalFailed'));
    } finally {
      setOpening(false);
    }
  };

  if (loading || !me) return null;

  const isOwner = me.role === 'owner';
  const reason = me.entitlementReason ?? 'none';
  const comped = reason === 'comp';
  const ending = reason === 'active_ending' || reason === 'cancelled_paid_through';
  const canManage = Boolean(me.hasBillingAccount) && isOwner;

  const statusLine = comped
    ? t('stateComped', { date: formatDate(me.compUntil, locale) })
    : ending
      ? t('stateEnding', { date: formatDate(me.subscriptionPeriodEnd, locale) })
      : me.isPro
        ? t('stateActive', { date: formatDate(me.subscriptionPeriodEnd, locale) })
        : t('stateFree');

  return (
    <section className="rounded-2xl bg-white p-6 space-y-3" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('sectionTitle')}</h2>

      <p className="text-sm" style={{ color: '#374151' }}>{statusLine}</p>

      {settling && (
        <p className="text-xs" style={{ color: '#6B7280' }}>{t('updating')}</p>
      )}

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

      {/* Not Pro → offer the upgrade. A lapsed household sees BOTH this and the
          manage button, which is correct: resubscribe, or go read old invoices. */}
      {!me.isPro && isOwner && <UpgradeButton />}

      {canManage && (
        <button
          onClick={openPortal}
          disabled={opening}
          className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all disabled:opacity-50"
          style={{ border: '1.5px solid #0F2044', color: '#0F2044' }}
        >
          {opening ? t('opening') : t('manage')}
        </button>
      )}

      {/* A member sees the state but not the controls — one subscription covers
          the household, and changing it is an owner-level administrative act. */}
      {!isOwner && (
        <p className="text-xs" style={{ color: '#6B7280' }}>{t('ownerOnlyNote')}</p>
      )}
    </section>
  );
}

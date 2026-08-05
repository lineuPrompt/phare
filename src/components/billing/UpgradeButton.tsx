'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * THE in-app entry point to checkout.
 *
 * Every Pro padlock in the product renders this, so there is exactly one place
 * that knows how to start a checkout. Before this existed the padlocks linked
 * to `/#pricing`, where the CTA was an inert div — a paywall that could not be
 * paid.
 *
 * WHY THE PLAN CHOICE LIVES HERE rather than on a pricing screen: the household
 * is already signed in and already looking at the thing they want. Sending them
 * to a marketing page to choose a cadence adds a step whose only purpose is to
 * lose people. Monthly is preselected because it is the lower commitment; the
 * annual saving is stated rather than defaulted to, which is the honest
 * direction for a default.
 *
 * Signed-out visitors never reach this — the landing CTA sends them to sign up
 * first, since checkout needs a household to attach the subscription to.
 */
export default function UpgradeButton({ className = '' }: { className?: string }) {
  const t = useTranslations('billing');
  const [plan, setPlan] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.url) {
        // Surface the server's own reason — a generic retry message hides
        // "only the owner can do this", which is actionable and common.
        setError(json?.error ?? t('checkoutFailed'));
        return;
      }
      // Stripe-hosted. Full navigation, not fetch — this leaves our origin.
      window.location.href = json.url;
    } catch {
      setError(t('checkoutFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['monthly', 'annual'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlan(p)}
            aria-pressed={plan === p}
            className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all"
            style={
              plan === p
                ? { background: '#0F766E', color: 'white' }
                : { border: '1.5px solid #99F6E4', color: '#0F766E', background: 'white' }
            }
          >
            {t(p === 'monthly' ? 'planMonthly' : 'planAnnual')}
          </button>
        ))}
      </div>

      {error && <p className="text-sm mb-2" style={{ color: '#DC2626' }}>{error}</p>}

      <button
        onClick={start}
        disabled={loading}
        className="px-6 py-2.5 rounded-full text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
        style={{ background: '#0F766E' }}
      >
        {loading ? t('starting') : t('upgradeCta')}
      </button>
    </div>
  );
}

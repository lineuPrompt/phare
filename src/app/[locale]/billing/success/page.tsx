'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';

/**
 * Where Stripe returns the household after a successful checkout.
 *
 * THIS PAGE READS. IT NEVER WRITES.
 *
 * That is the whole design. Stripe commonly fires checkout.session.completed
 * before the browser finishes redirecting here, so if this page also recorded
 * the subscription it would race the webhook and one would clobber the other.
 * With the webhook as the only writer, this page's job is simply to wait for
 * the state to appear and say something truthful while it does.
 *
 * It polls /api/me until `isPro` flips. Three honest states:
 *   activating — normal, a few seconds
 *   ready      — entitlement arrived
 *   slow       — the webhook has not landed. The copy says the payment is safe
 *                and gives a real next step, because "loading…" forever after
 *                someone has just been charged is the worst possible screen.
 *
 * NOTE: until the webhook ships (piece 5) nothing ever writes the state, so
 * this page will always reach the `slow` branch. That is expected and is why
 * no real checkout link is exposed yet.
 */

const POLL_MS = 2000;
const GIVE_UP_AFTER_MS = 45_000;

export default function BillingSuccessPage() {
  const t = useTranslations('dashboard');
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [state, setState] = useState<'activating' | 'ready' | 'slow'>('activating');

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/me');
        const me = res.ok ? await res.json() : null;
        if (cancelled) return;

        if (me?.isPro) {
          setState('ready');
          return; // stop polling
        }
      } catch {
        // Network blips are expected while a payment settles; keep waiting
        // rather than declaring failure on one failed request.
      }

      if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
        setState('slow');
        return; // stop polling — a spinner that never ends is not information
      }
      timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4" style={{ color: '#0F2044' }}>
          {t('successTitle')}
        </h1>

        <p className="text-sm mb-8" style={{ color: state === 'slow' ? '#92400E' : '#6B7280' }}>
          {state === 'ready' ? t('successReady')
            : state === 'slow' ? t('successSlow')
            : t('successActivating')}
        </p>

        {/* Always available. Even in the slow state the household should be
            able to get on with using Phare — their data is untouched and the
            free tier still works. */}
        <Link
          href={`/${locale}/dashboard`}
          className="inline-block px-6 py-2.5 rounded-full text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-all"
          style={{ background: '#0F2044' }}
        >
          {t('successToDashboard')}
        </Link>
      </div>
    </main>
  );
}

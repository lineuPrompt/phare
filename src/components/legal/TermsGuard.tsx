'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Redirects any signed-in user who has not accepted the CURRENT legal version
 * to the consent screen. Mounted once in the locale layout, so it covers every
 * page without each one remembering to check.
 *
 * Renders nothing.
 *
 * EXEMPT PATHS, and each is a deadlock if you forget it:
 *   - the consent screen itself (it would redirect to itself forever);
 *   - /privacy, /terms, /faq — you cannot require someone to accept documents
 *     they are not allowed to open, and the consent checkbox links straight
 *     to them;
 *   - /signin, /set-password, /auth/callback — pre-consent by definition;
 *   - the landing page, which is public.
 *
 * NOT A SECURITY BOUNDARY. This is a client-side redirect and can be bypassed
 * by anyone willing to use devtools. It exists so a real household is asked
 * before continuing to use the product — not to protect data. Any route that
 * must genuinely refuse unaccepted users has to check server-side; nothing does
 * today, which is the correct scope for a consent prompt.
 */
const EXEMPT = [
  '/accept-terms',
  '/privacy',
  '/terms',
  '/faq',
  '/signin',
  '/set-password',
  '/auth/',
];

export default function TermsGuard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
    // Strip the locale prefix so the exempt list stays locale-agnostic.
    const path = pathname.replace(/^\/(en|fr)/, '') || '/';

    // The landing page is public; an exact match only, so it does not exempt
    // every path that happens to start with a slash.
    if (path === '/') return;
    if (EXEMPT.some((p) => path.startsWith(p))) return;

    let cancelled = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled || !me) return;          // 401 → not signed in, not our business
        if (me.termsCurrent) return;
        router.replace(`/${locale}/accept-terms?next=${encodeURIComponent(pathname)}`);
      })
      .catch(() => { /* never block the app on this check */ });

    return () => { cancelled = true; };
  }, [pathname, router]);

  return null;
}

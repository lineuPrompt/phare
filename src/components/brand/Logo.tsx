import Image from 'next/image';
import Link from 'next/link';
import { useLocale } from 'next-intl';

/**
 * The logo is the app-wide "home" affordance — it sits in Navbar, which is on
 * every page. It used to be a bare `<a href="/">`, which cost two things on
 * every single click:
 *
 *   - a full document reload instead of client-side navigation, from anywhere
 *     in the app;
 *   - the locale. `/` is not a real route under this routing config (every
 *     page lives at /en/… or /fr/…), so the middleware had to re-derive the
 *     locale on arrival. A French user's `fr` survived only because the
 *     NEXT_LOCALE cookie happened to be set — cleared or blocked cookies, and
 *     they landed on the English home page from a French screen.
 *
 * `useLocale()` reads the locale already resolved for the current render
 * (works in both server and client trees — Navbar is rendered from both), so
 * the destination is explicit rather than something the middleware guesses.
 */
export default function Logo({ className = '' }: { className?: string }) {
  const locale = useLocale();

  return (
    <Link href={`/${locale}`} className="flex items-center">
      <Image
        src="/assets/logo_phare_line.png"
        alt="Phare.money"
        width={180}
        height={48}
        style={{ width: 'auto', height: '108px' }}
        className={className}
        priority
        unoptimized
      />
    </Link>
  );
}

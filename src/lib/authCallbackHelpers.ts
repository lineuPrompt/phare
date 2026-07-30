export type SupportedLocale = 'en' | 'fr';

/**
 * Pick the locale for the auth callback's interstitial redirect out of the
 * `next` param it was handed.
 *
 * The callback used to send everyone to /en/set-password, so a French member
 * following a recovery link saw an English "Set your password" page and only
 * landed back in French afterwards. `next` already carries the destination
 * locale (e.g. /fr/dashboard), so it's the honest source — no extra param, no
 * lookup, nothing new for callers to pass.
 *
 * Anything unrecognized falls back to 'en': absent, empty, a bare path with no
 * locale segment, an unsupported locale, or a full URL. This is display copy on
 * a page reached by a one-time token — a wrong guess should degrade to the
 * default language, never throw and strand someone mid-reset.
 */
export function localeFromNext(next: string | null | undefined): SupportedLocale {
  if (!next) return 'en';

  // Tolerate a query string or hash riding along, and an absolute URL.
  const pathOnly = next.split(/[?#]/)[0];
  const firstSegment = pathOnly.split('/').filter(Boolean)[0];

  return firstSegment === 'fr' ? 'fr' : 'en';
}

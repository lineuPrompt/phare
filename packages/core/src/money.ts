/**
 * Currency formatting.
 *
 * MOVED HERE UNCHANGED from src/components/onboarding/types.ts. The body is
 * byte-for-byte what it was; the en-CA hardcoding is preserved deliberately,
 * because changing it would change what the onboarding flow renders and this
 * was a move, not a fix.
 *
 * SEE THE README — formatCAD is one of FOUR currency formatters in this repo.
 * The other three (src/components/{dashboard,recurring,expenses}/types.ts)
 * are a locale-aware `formatCurrency(amount, locale)` and are identical to
 * each other. Unifying all four is real, separate work with a visible
 * behaviour change attached; it is deliberately NOT done here.
 */

/**
 * The onboarding flow's currency formatter. Always renders en-CA, for every
 * user, in every locale — see the file header and the README's Known
 * Limitations. Preserved exactly as it was.
 */
export function formatCAD(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

/**
 * Locale-aware CAD formatting — the same shape the web app's three
 * `formatCurrency(amount, locale)` copies already use, expressed once.
 *
 * NOT wired into the web app. It exists so the fr-CA output form is pinned by
 * tests (see money.test.ts, which asserts the U+00A0 NO-BREAK SPACE both as
 * the thousands separator and before the `$`) and so the Expo app has a
 * locale-correct formatter available without inheriting formatCAD's en-CA
 * hardcoding. Wiring the web app onto this is the separate unification work.
 *
 * `locale` takes the app's short locale code ('en' | 'fr'), matching the
 * existing formatCurrency signature rather than inventing a new convention.
 */
export function formatCADLocale(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}

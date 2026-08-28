/**
 * Message lookup and interpolation — the pure half of i18n, with no React and
 * no React Native in it so the test suite can exercise it directly.
 *
 * WHY NOT next-intl, THE WEB APP'S LIBRARY: it is built around the Next.js
 * request lifecycle (a server component tree, a middleware-resolved locale, a
 * per-request provider). None of that exists here. Its message FORMAT is what
 * matters for keeping the two apps comparable, and that is what this matches:
 * dot-separated keys into a nested catalogue, `{name}` placeholders.
 *
 * WHAT IS DELIBERATELY NOT SUPPORTED: ICU plurals and selects
 * (`{count, plural, one {...} other {...}}`). The web app's catalogue uses
 * them; this scaffold's does not, and a half-implementation that silently
 * mangles a plural would be worse than an honest absence. Add real ICU parsing
 * — or the library — at the point the first plural is actually needed, not
 * before.
 */

export type Locale = 'en' | 'fr';

export const LOCALES: Locale[] = ['en', 'fr'];

/** A catalogue is arbitrarily nested objects bottoming out in strings. */
export type Catalog = { [key: string]: string | Catalog };

/**
 * Resolves a dot path to a string, or null when the path is missing or lands
 * on a nested object rather than a leaf.
 *
 * Returns null rather than throwing so a missing key degrades to something
 * visible on screen instead of a crash — the parity test is what guarantees
 * there are none, and it fails the build rather than the user's session.
 */
export function lookup(catalog: Catalog, key: string): string | null {
  const parts = key.split('.');
  let node: string | Catalog | undefined = catalog;

  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return null;
    node = node[part];
  }

  return typeof node === 'string' ? node : null;
}

/**
 * Substitutes `{name}` placeholders.
 *
 * An unmatched placeholder is LEFT AS-IS rather than replaced with an empty
 * string: `{amount}` visible on screen is an obvious bug report, while a
 * silently blank space in the middle of a sentence about money is not.
 */
export function interpolate(
  template: string,
  values?: Record<string, string | number>
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole
  );
}

/**
 * Every leaf key in a catalogue, dot-joined, sorted.
 *
 * Exists for the parity test — comparing sorted key lists is what catches a
 * key present in one locale and absent in the other, which is the failure the
 * web app's own i18nKeys test was written for.
 */
export function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      keys.push(path);
    } else {
      keys.push(...flattenKeys(value, path));
    }
  }

  return keys.sort();
}

/**
 * Builds the `t` function for one catalogue.
 *
 * The returned signature matches the web app's next-intl call shape —
 * `t('some.key')` and `t('some.key', { amount })` — so copy moves between the
 * two apps without being rewritten.
 */
export function makeTranslator(catalog: Catalog) {
  return function t(key: string, values?: Record<string, string | number>): string {
    const template = lookup(catalog, key);
    if (template === null) return key;
    return interpolate(template, values);
  };
}

export type Translator = ReturnType<typeof makeTranslator>;

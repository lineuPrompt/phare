import { describe, it, expect } from 'vitest';
import { localeFromNext } from '../authCallbackHelpers';

// The auth callback sends recovery links through a set-password interstitial.
// It used to hardcode /en/, so French members setting a password saw an
// English page. The locale now comes from the `next` param — these pin that
// mapping, and pin that anything unrecognized degrades to 'en' rather than
// throwing, since this runs mid-reset on a one-time token.

describe('localeFromNext', () => {
  it('carries fr through', () => {
    expect(localeFromNext('/fr/dashboard')).toBe('fr');
  });

  it('carries en through', () => {
    expect(localeFromNext('/en/dashboard')).toBe('en');
  });

  it('falls back to en when next is absent', () => {
    expect(localeFromNext(null)).toBe('en');
    expect(localeFromNext(undefined)).toBe('en');
    expect(localeFromNext('')).toBe('en');
  });

  it('falls back to en on a garbled or locale-less next', () => {
    for (const garbled of ['/', '///', 'dashboard', '/dashboard', '/es/dashboard', '/EN/dashboard', '   ']) {
      expect(localeFromNext(garbled)).toBe('en');
    }
  });

  it('reads the locale from deeper paths, not just /dashboard', () => {
    expect(localeFromNext('/fr/goals')).toBe('fr');
    expect(localeFromNext('/fr/household/members')).toBe('fr');
  });

  it('ignores a query string or hash riding along', () => {
    expect(localeFromNext('/fr/dashboard?tab=plan')).toBe('fr');
    expect(localeFromNext('/fr/dashboard#section')).toBe('fr');
    expect(localeFromNext('/en/dashboard?next=/fr/elsewhere')).toBe('en');
  });

  it('does not mistake a URL scheme for a locale', () => {
    expect(localeFromNext('https://phare.money/fr/dashboard')).toBe('en');
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';

/**
 * The legal and help pages must stay reachable from INSIDE the app.
 *
 * They shipped reachable from exactly one place — the landing-page footer —
 * which a signed-in household never sees. Someone confused about why a card
 * charge landed in next month's tab is on the dashboard, not the marketing
 * page, and had no route to the FAQ short of signing out or guessing the URL.
 * The account dropdown is now that route, and it is the ONLY one: there is no
 * authenticated footer and no sidebar entry to fall back on, so if these links
 * are dropped from AuthButton the in-app path is gone again with nothing else
 * failing.
 *
 * This is a source-level assertion rather than a render test on purpose — the
 * project has no jsdom/testing-library and this file is not the place to
 * introduce them. The same trade-off (and the same regex-over-source approach)
 * is already made by messages/__tests__/i18nKeys.test.ts.
 */

const AUTH_BUTTON = path.join(__dirname, '..', 'AuthButton.tsx');
const NAVBAR = path.join(__dirname, '..', 'Navbar.tsx');

describe('in-app reachability of the legal pages', () => {
  const src = fs.readFileSync(AUTH_BUTTON, 'utf8');

  // Locale-interpolated, so /fr readers land on the French document rather
  // than being bounced to English.
  for (const route of ['faq', 'privacy', 'terms'] as const) {
    it(`the account dropdown links to /\${locale}/${route}`, () => {
      expect(src, `AuthButton no longer links to /${route}`).toContain(
        '`/${locale}/' + route + '`'
      );
    });
  }

  it('uses the same labels as the landing-page footer, and they resolve in both locales', () => {
    // Reused keys, not duplicated copy — the two surfaces cannot drift.
    for (const key of ['footerFaq', 'footerPrivacy', 'footerTerms'] as const) {
      expect(src, `AuthButton stopped using legal.${key}`).toContain(`tLegal('${key}')`);
      for (const [name, messages] of [['en', en], ['fr', fr]] as const) {
        const value = (messages.legal as Record<string, string>)[key];
        expect(typeof value === 'string' && value.length > 0, `${name}.legal.${key}`).toBe(true);
      }
    }
  });

  it('hangs off Navbar, which is what puts it on every authenticated page', () => {
    // AuthButton is only ubiquitous because Navbar renders it and every app
    // page renders Navbar. If that composition breaks, the dropdown stops
    // being a reliable route even though its own links still look correct.
    expect(fs.readFileSync(NAVBAR, 'utf8')).toContain('<AuthButton />');
  });
});

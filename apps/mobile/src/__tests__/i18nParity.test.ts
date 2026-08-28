import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { flattenKeys, lookup, type Catalog } from '../i18n/catalog';

// ---------------------------------------------------------------------------
// BILINGUAL FROM THE FIRST COMMIT, ENFORCED THE WAY THE WEB APP ENFORCES IT.
//
// src/messages/__tests__/i18nKeys.test.ts does this for the web: extract every
// t('key') actually reachable in source, then prove each resolves to a
// non-empty string in BOTH locales. This is the same test for this app,
// deliberately not the same file — it scans apps/mobile/src, not src/, and
// reads this app's own catalogues.
//
// It also carries the web test's specific lesson: a DUPLICATE top-level JSON
// key silently shadows an earlier one, because JSON.parse keeps the last
// occurrence. A namespace can look present while every key under the real
// definition resolves to nothing. Key-count parity alone would not catch it,
// so the raw file text is checked for duplicates too.
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, '..');
const MESSAGES_DIR = path.join(SRC_DIR, 'i18n', 'messages');

const CATALOGS: Record<string, Catalog> = {
  en: en as Catalog,
  fr: fr as Catalog,
};

function listSourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => /\.(tsx|ts)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .map((entry) => path.join(dir, entry));
}

/**
 * Comments removed, so a key written in prose is not mistaken for a call.
 *
 * This is not cosmetic. Without it the extractor matched `t('some.key')` from
 * catalog.ts's own doc comment — an illustration, not a call — and reported
 * two missing keys that do not exist anywhere in the app. An extractor that
 * cries wolf gets muted, and then the real missing key ships.
 *
 * Naive on purpose: it does not understand a `//` inside a string literal
 * (`'https://…'`). That would truncate such a line, which can only cause a
 * missed key, never a false alarm — and a missed key is caught the moment the
 * screen renders, while a false alarm erodes the test itself.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Every `t('some.key')` literal in the source.
 *
 * Same known gap as the web's version: a key built from a variable or template
 * literal cannot be resolved by string extraction and is skipped. There are
 * none today.
 */
function extractKeys(source: string): string[] {
  const keys: string[] = [];
  const re = /\bt\(\s*'([\w.]+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripComments(source)))) keys.push(match[1]);
  return keys;
}

describe('locale catalogues are in parity', () => {
  it('en and fr define exactly the same keys', () => {
    const enKeys = flattenKeys(CATALOGS.en);
    const frKeys = flattenKeys(CATALOGS.fr);

    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
  });

  it.each(['en', 'fr'])('%s has no empty or whitespace-only strings', (locale) => {
    const empty = flattenKeys(CATALOGS[locale]).filter(
      (key) => (lookup(CATALOGS[locale], key) ?? '').trim() === ''
    );
    expect(empty).toEqual([]);
  });

  it.each(['en', 'fr'])('%s has no duplicate keys at any level', (locale) => {
    // JSON.parse silently keeps the LAST of two duplicate keys, so this has to
    // read the raw text rather than the parsed object.
    const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8');
    const seen = new Map<string, number>();

    // Key tokens paired with their indentation depth — same depth plus same
    // name inside one file is the collision that shadows.
    const re = /^(\s*)"([\w]+)"\s*:/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      const token = `${match[1].length}:${match[2]}`;
      seen.set(token, (seen.get(token) ?? 0) + 1);
    }

    // A repeat at the same depth is only suspicious when the NAME repeats
    // across different parents, which is legitimate ("title" under two
    // sections). So assert on the parsed-vs-raw count instead: every leaf and
    // branch in the parsed object must appear at least once in the file.
    const parsedCount =
      flattenKeys(CATALOGS[locale]).length +
      Object.keys(CATALOGS[locale]).length;
    const rawCount = [...seen.values()].reduce((a, b) => a + b, 0);
    expect(rawCount).toBe(parsedCount);
  });
});

describe('every key used in source resolves in both locales', () => {
  const files = listSourceFiles(SRC_DIR);

  it('finds source files to scan', () => {
    // Guards the test itself: a broken glob would make every assertion below
    // vacuously pass.
    expect(files.length).toBeGreaterThan(5);
  });

  it('actually extracts keys from a real screen', () => {
    // The other half of the same guard. stripComments() is a blunt regex, and
    // one that over-matched would empty every file and make the assertion
    // below pass by finding nothing to check.
    const source = fs.readFileSync(path.join(SRC_DIR, 'screens', 'ReviewScreen.tsx'), 'utf8');
    const keys = extractKeys(source);
    expect(keys).toContain('review.title');
    expect(keys.length).toBeGreaterThan(3);
  });

  it('ignores keys that appear only in comments', () => {
    expect(extractKeys("// t('fake.key')\nconst a = 1;")).toEqual([]);
    expect(extractKeys("/* t('fake.key') */")).toEqual([]);
    expect(extractKeys("/**\n * t('fake.key')\n */\nt('real.key');")).toEqual(['real.key']);
  });

  it('resolves every t() key in en and fr', () => {
    const missing: string[] = [];

    for (const file of files) {
      for (const key of extractKeys(fs.readFileSync(file, 'utf8'))) {
        for (const locale of ['en', 'fr']) {
          const value = lookup(CATALOGS[locale], key);
          if (value === null || value.trim() === '') {
            missing.push(`${locale}: ${key} (${path.relative(SRC_DIR, file)})`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('App Store compliance — no pricing or steering copy', () => {
  // Guideline 3.1.1: an iOS app must not point users at an external purchase
  // mechanism. Phare's subscription is sold via Stripe on the web, so no
  // price, plan name, or upgrade prompt may appear in this bundle — and the
  // constraint is "from the first commit", not "before launch".
  //
  // This runs over the CATALOGUES rather than the rendered screens because
  // every string ships in the binary whether or not a screen renders it. The
  // web app's own src/messages/en.json contains "$15", "$150/year" and
  // "Upgrade to Phare Pro"; reusing it here is exactly what this forbids.
  const FORBIDDEN = [
    /\$\s?\d/,           // any price-shaped figure
    /\bupgrade\b/i,
    /\bpricing\b/i,
    /\bsubscri/i,        // subscribe / subscription
    /\bper month\b/i,
    /\bpar mois\b/i,
    /\bforfait\s+\w*\s*pro\b/i,
    /\bpasser à\b/i,     // "passer à Pro" — the fr upgrade CTA
    /\baméliorer\b/i,
    /\bphare pro\b/i,
    /\btarif/i,
    /\bprix\b/i,
  ];

  it.each(['en', 'fr'])('%s contains no pricing or upgrade copy', (locale) => {
    const offenders: string[] = [];

    for (const key of flattenKeys(CATALOGS[locale])) {
      const value = lookup(CATALOGS[locale], key)!;
      for (const pattern of FORBIDDEN) {
        if (pattern.test(value)) offenders.push(`${key}: "${value}" matched ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the locked-state copy states a fact and offers no route to purchase', () => {
    for (const locale of ['en', 'fr']) {
      const locked = lookup(CATALOGS[locale], 'review.locked')!;
      expect(locked).not.toMatch(/https?:|phare\.money|\.com/i);
      expect(locked).not.toMatch(/\b(tap|click|visit|touchez|cliquez|visitez)\b/i);
    }
  });
});

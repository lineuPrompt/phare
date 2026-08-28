import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// APP STORE COMPLIANCE, CHECKED OVER ALL SOURCE — not just the catalogues.
//
// i18nParity.test.ts checks the message files. This checks everything else,
// because a price does not have to be in a catalogue to ship: a hardcoded
// string in a screen, a fixture, or a comment-free constant all end up in the
// binary just the same. That is not hypothetical — the first build of the
// diagnostics screen carried a "$450/month" fixture string, which showed up in
// a grep of the compiled Hermes bundle and had to be removed. It was a budget
// figure, not a price, but it was indistinguishable from one in an audit.
//
// Guideline 3.1.1: an iOS app may not steer users to an external purchase
// mechanism. Phare sells through Stripe on the web, so this bundle must carry
// no price, no plan name, no upgrade prompt, and no link that leads to one.
// The constraint is "from the first commit", so this test exists from the
// first commit.
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.resolve(__dirname, '..', '..', 'app');

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => /\.(tsx|ts|json)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .map((entry) => path.join(dir, entry))
    .filter((file) => fs.statSync(file).isFile());
}

const FILES = [...listFiles(SRC_DIR), ...listFiles(APP_DIR)];

/** Comments stripped: prose ABOUT the rule must not trip the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('no purchase-steering surface anywhere in the app source', () => {
  it('has files to scan', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  // The `(?<![.\w])` guard on the word patterns keeps an IDENTIFIER from
  // reading as copy. Without it this flagged `sub.subscription.unsubscribe()`
  // — the Supabase auth listener in useSession.ts, which has nothing to do
  // with billing. A compliance test that fires on unrelated code gets
  // weakened or deleted, and then it is not protecting anything.
  it.each([
    ['a currency figure', /\$\s?\d/],
    ['the word upgrade', /(?<![.\w])upgrade\b/i],
    ['the word pricing', /(?<![.\w])pricing\b/i],
    ['subscribe/subscription', /(?<![.\w])subscri(be|ption)\b/i],
    ['a per-month price form', /\d\s*\/\s*(month|mo|mois)\b/i],
    ['the Pro plan name', /(?<![.\w])phare\s+pro\b/i],
  ])('contains no %s', (_label, pattern) => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const source = file.endsWith('.json')
        ? fs.readFileSync(file, 'utf8')
        : code(fs.readFileSync(file, 'utf8'));

      for (const line of source.split('\n')) {
        if (pattern.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('links to no external purchase or pricing destination', () => {
    // A link to the marketing site's pricing page is the same violation as a
    // button. phare.money is referenced in copy (the reset-password hint) as a
    // bare word, which is fine — a tappable URL is not.
    const offenders: string[] = [];

    for (const file of FILES) {
      const source = fs.readFileSync(file, 'utf8');
      for (const line of code(source).split('\n')) {
        if (/https?:\/\/[^\s'"]*\/(pricing|billing|checkout|upgrade)/i.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the web app\'s message catalogue is not reachable from mobile', () => {
  it('nothing imports from the web src/messages', () => {
    // src/messages/en.json contains "$15", "$150/year" and "Upgrade to Phare
    // Pro". next-intl serialises the entire tree into what it ships, and the
    // same is true of a bundler here: importing it would put those strings in
    // the binary whether or not a screen renders them.
    const offenders: string[] = [];

    for (const file of FILES) {
      const source = code(fs.readFileSync(file, 'utf8'));
      if (/from\s+['"][^'"]*\.\.\/\.\.\/\.\.\/src\//.test(source)) {
        offenders.push(path.relative(SRC_DIR, file));
      }
      if (/messages\/(en|fr)\.json/.test(source) && !file.includes(path.join('i18n'))) {
        offenders.push(`${path.relative(SRC_DIR, file)} (message import outside i18n/)`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

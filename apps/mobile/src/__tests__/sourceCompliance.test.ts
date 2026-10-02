import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FORBIDDEN_TEXT, findViolations, OWN_COPY_ALLOWLIST, POLICY_SENTENCE_ALLOWLIST, CATEGORY_NAME_ALLOWLIST } from './complianceScan';
import { PRIVACY_POLICY, SEED_EXPENSE_CATEGORIES } from '@phare/core';

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
// @phare/core is compiled into this app's bundle, so its source is this app's
// source for the purpose of this rule — a string added there ships here.
const CORE_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'core', 'src');

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => /\.(tsx|ts|json)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .map((entry) => path.join(dir, entry))
    .filter((file) => fs.statSync(file).isFile());
}

const FILES = [...listFiles(SRC_DIR), ...listFiles(APP_DIR), ...listFiles(CORE_DIR)];

/** Comments stripped: prose ABOUT the rule must not trip the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('no purchase-steering surface anywhere in the app source', () => {
  it('has files to scan', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  // The patterns live in complianceScan.ts, shared with the catalogue scan and
  // the compiled-bundle scan, so the three cannot drift into three different
  // definitions of "a price". The word patterns' `(?<![.\w])` guard keeps an
  // IDENTIFIER from reading as copy: without it this flagged
  // `sub.subscription.unsubscribe()` — the Supabase auth listener in
  // useSession.ts, which has nothing to do with billing. A compliance test
  // that fires on unrelated code gets weakened or deleted, and then it is not
  // protecting anything. The currency pattern's own history is in that file.
  const TABLE = FORBIDDEN_TEXT.map(([label, pattern]) => [label, pattern] as const);

  it('runs every shared pattern, not a subset', () => {
    // Today's source contains no price, so dropping a pattern from this table
    // would leave every assertion below green — mutation-tested, it survived.
    // This is what fails instead.
    expect(TABLE.map(([label]) => label)).toEqual(FORBIDDEN_TEXT.map(([label]) => label));
    expect(TABLE.map(([label]) => label)).toContain('a currency figure');
  });

  it.each(TABLE)('contains no %s', (label) => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const source = file.endsWith('.json')
        ? fs.readFileSync(file, 'utf8')
        : code(fs.readFileSync(file, 'utf8'));

      for (const line of source.split('\n')) {
        // Same rule as the bundle scan: a hit inside an excused sentence of
        // our own copy (OWN_COPY_ALLOWLIST) passes; any other hit fails.
        if (findViolations([line], OWN_COPY_ALLOWLIST).some((v) => v.label === label)) {
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

describe('our own excused copy is pinned (2026-10-02)', () => {
  it('each Privacy Policy allowlist sentence appears verbatim in the policy, EN then FR', () => {
    // Fails the moment the policy wording changes: the excuse is for this
    // exact sentence, never for whatever replaces it.
    const [en, fr] = POLICY_SENTENCE_ALLOWLIST;
    expect(PRIVACY_POLICY.en.sections.flatMap((s) => s.body)).toContain(en);
    expect(PRIVACY_POLICY.fr.sections.flatMap((s) => s.body)).toContain(fr);
  });

  it('each policy sentence still needs its excuse — it contains a forbidden hit', () => {
    // If the sentence is ever reworded to pass on its own, its entry must go.
    for (const sentence of POLICY_SENTENCE_ALLOWLIST) {
      expect(findViolations([sentence]).length, sentence).toBeGreaterThan(0);
      expect(findViolations([sentence], OWN_COPY_ALLOWLIST)).toEqual([]);
    }
  });

  it('the excused category name is exactly a seed category, and still needs its excuse', () => {
    for (const name of CATEGORY_NAME_ALLOWLIST) {
      expect(SEED_EXPENSE_CATEGORIES as readonly string[]).toContain(name);
      expect(findViolations([name]).length, name).toBeGreaterThan(0);
    }
  });

  it('the excuse covers those exact strings only: the same words anywhere else still fail', () => {
    expect(findViolations(['Unlock paid subscriptions today'], OWN_COPY_ALLOWLIST).map((v) => v.label))
      .toContain('subscribe/subscription');
    expect(findViolations(['Passez à un abonnement payant'], OWN_COPY_ALLOWLIST).map((v) => v.label))
      .toEqual(expect.arrayContaining(['abonnement (French: subscription)', 'payant (French: paid plan or feature)']));
    expect(findViolations(['Your Subscriptions'], OWN_COPY_ALLOWLIST).length).toBeGreaterThan(0);
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

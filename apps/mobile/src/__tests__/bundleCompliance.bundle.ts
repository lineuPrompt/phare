import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStrings, findViolations, hermesStrings, OWN_COPY_ALLOWLIST } from './complianceScan';

// ---------------------------------------------------------------------------
// APP STORE COMPLIANCE, CHECKED OVER THE COMPILED BUNDLE.
//
// Run with `pnpm --filter @phare/mobile bundle:check`, which exports a fresh
// Android bundle into dist/ and then runs this file under
// vitest.bundle.config.ts. It is NOT part of `pnpm test`: it needs a bundle,
// and a check that silently skips when the bundle is missing is a check that
// passes without looking.
//
// sourceCompliance.test.ts scans what we wrote. This scans what ships — which
// also contains @phare/core, every library, and anything a bundler pulled in
// that no source grep would think to look at (the web message catalogue, if
// someone ever imported it, is exactly that).
//
// Until 2026-09-15 this was a manual grep, and it had two blind spots, both
// fixed here: the loose `\$\s?\d` pattern produced 154 hits of bytecode noise,
// and a byte grep cannot see any string Hermes stored as UTF-16LE — which is
// every French string with an accent. See complianceScan.ts.
// ---------------------------------------------------------------------------

const APP_ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE_DIR = path.join(APP_ROOT, 'dist', '_expo', 'static', 'js');

/**
 * Library sentences that contain a forbidden WORD and are not copy of ours.
 * Each is excused only where the hit sits inside this exact sentence, and the
 * last test below fails if an entry stops matching anything — so the list
 * cannot silently outlive the library text it was written for.
 */
const LIBRARY_ALLOWLIST = [
  // @supabase/realtime-js — an error for self-hosters on an old Realtime server.
  'or upgrade the Realtime server in your self-hosted setup',
  // @supabase/supabase-js — the Node.js version deprecation warning.
  'Please upgrade to Node.js 22 or later',
  // Removed 2026-10-23: the two `subscribe` sentences (an auth-js lock
  // timeout, a React Native event-emitter warning). "subscribe" stopped being
  // forbidden on 2026-10-17, and read string by string the first no longer
  // exists as one sentence.
];

/**
 * Library strings excused only when a WHOLE string equals the entry — never a
 * string that merely contains it. Possible since the scan reads each string
 * exactly (hermesStrings); a bare word as a sentence entry would excuse that
 * word everywhere, our own copy included.
 */
const LIBRARY_EXACT_STRINGS = [
  // A Material Icons glyph name in a bundled icon font's name table (its
  // neighbours there: 'grade', 'eraser_size_4', 'how_to_reg'). Not copy.
  'upgrade',
];

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map((entry) => path.join(dir, entry))
    .filter((file) => fs.statSync(file).isFile());
}

function newestMtime(dirs: string[]): { file: string; mtime: number } {
  let newest = { file: '', mtime: 0 };
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime > newest.mtime) newest = { file, mtime };
    }
  }
  return newest;
}

const bundles = listFiles(BUNDLE_DIR).filter((f) => /\.(hbc|js)$/.test(f));

describe('the compiled bundle carries no purchase-steering text', () => {
  it('a bundle exists to scan', () => {
    expect(bundles.length, `no bundle under ${BUNDLE_DIR} — run bundle:check`).toBeGreaterThan(0);
  });

  it('the bundle is newer than every source file that feeds it', () => {
    // A stale dist/ from last month would pass this scan on behalf of code it
    // never contained. Found in practice: the dist/ present on 2026-09-15
    // dated from 2026-08-28, before that morning's dependency change.
    const source = newestMtime([
      path.join(APP_ROOT, 'src'),
      path.join(APP_ROOT, 'app'),
      path.resolve(APP_ROOT, '..', '..', 'packages', 'core', 'src'),
    ]);
    for (const bundle of bundles) {
      expect(
        fs.statSync(bundle).mtimeMs,
        `${path.basename(bundle)} is older than ${source.file}`
      ).toBeGreaterThan(source.mtime);
    }
  });

  // A Hermes file is read through its own string table (hermesStrings): each
  // string exactly, in its own encoding. Reading byte runs instead let a
  // UTF-16 library string read as a "$64555" price (2026-10-23).
  const strings = bundles.flatMap((file) =>
    file.endsWith('.hbc') ? hermesStrings(fs.readFileSync(file)) : extractStrings(fs.readFileSync(file))
  );

  it('extracts both ASCII and UTF-16LE strings from this bundle, exactly', () => {
    // Guards the scan itself. If the reader broke, every assertion below
    // would pass by finding nothing. One known string from each encoding,
    // each a whole string of its own — not a fragment of a byte run.
    expect(strings).toContain('Try again');
    expect(strings).toContain('Réessayer');
    expect(strings.length).toBeGreaterThan(10_000);
  });

  it('contains no forbidden text outside the library and own-copy allowlists', () => {
    const scanned = strings.filter((s) => !LIBRARY_EXACT_STRINGS.includes(s));
    expect(findViolations(scanned, [...LIBRARY_ALLOWLIST, ...OWN_COPY_ALLOWLIST])).toEqual([]);
  });

  it('every allowlist entry still matches something', () => {
    for (const sentence of [...LIBRARY_ALLOWLIST, ...OWN_COPY_ALLOWLIST]) {
      expect(strings.some((s) => s.includes(sentence)), sentence).toBe(true);
    }
    for (const exact of LIBRARY_EXACT_STRINGS) {
      expect(strings.includes(exact), `exact string: ${exact}`).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStrings, findViolations } from './complianceScan';

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
  // @supabase/auth-js — a navigator lock timeout message.
  'acquisition timed out after `subscribe()`',
  // An event-emitter warning inside the React Native runtime.
  'Trying to subscribe to unknown event',
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

  const strings = bundles.flatMap((file) => extractStrings(fs.readFileSync(file)));

  it('extracts both ASCII and UTF-16LE strings from this bundle', () => {
    // Guards the scan itself. If either decoder broke, every assertion below
    // would pass by finding nothing. One known string from each encoding.
    expect(strings.some((s) => s.includes('Try again'))).toBe(true);
    expect(strings.some((s) => s.includes('Réessayer'))).toBe(true);
  });

  it('contains no forbidden text outside the library allowlist', () => {
    expect(findViolations(strings, LIBRARY_ALLOWLIST)).toEqual([]);
  });

  it('every allowlist entry still matches something', () => {
    for (const sentence of LIBRARY_ALLOWLIST) {
      expect(strings.some((s) => s.includes(sentence)), sentence).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE ONE DEFINITION OF "PURCHASE-STEERING TEXT", shared by the source scan
// (sourceCompliance.test.ts), the catalogue scan (i18nParity.test.ts) and the
// compiled-bundle scan (bundleCompliance.bundle.ts).
//
// Not a test file itself — vitest only collects *.test.ts — and it lives under
// __tests__ so the source scan, which skips that directory, never scans its own
// pattern definitions.
//
// WHY THE CURRENCY PATTERN IS NOT `\$\s?\d` ANY MORE (2026-09-15). That was
// fine over our own source, and useless over the compiled Hermes bundle: it
// matched 154 times there, none of them a price. Two kinds of noise —
//   1. minifier suffixes glued to identifiers: `getInstanceFromNode$1`,
//      `unstable_batchedUpdates$19`;
//   2. raw bytecode, where a 0x24 byte followed by a digit byte is simply
//      common.
// A scan that always has 150 findings gets read as "always has findings", and
// then the one real price goes unnoticed. The pattern below requires a figure
// that reads like money, bounded on both sides; the bundle scan additionally
// looks only inside extracted string runs, never at raw bytes.
//
// THE ACCEPTED GAP: a single-digit whole-dollar figure with no cents ("$5").
// It is indistinguishable from a regex backreference (`'$1'`), no Phare price
// has that shape ($15, $150), and "$5.00" is still caught.
// ---------------------------------------------------------------------------

export const CURRENCY_FIGURE = new RegExp(
  String.raw`(?<![\w$.\\])` +
    '(?:' +
    String.raw`\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?` + // $1,234 / $1,234.50
    '|' +
    String.raw`\$\s?\d{2,}(?:[.,]\d{2})?` + //             $15 / $150 / $15.00
    '|' +
    String.raw`\$\s?\d[.,]\d{2}` + //                      $5.00
    '|' +
    // fr-CA puts the sign after, separated by U+00A0 (formatCADLocale) or a
    // narrow/plain space when typed by hand: "15 $", "1 234,50 $".
    String.raw`\d+(?:[.,]\d{2})?[ \u00A0\u202F]\$` +
    ')' +
    String.raw`(?![\w$])`,
  'u'
);

/**
 * Every pattern that must not appear in shipped text. `wordGuard` patterns
 * refuse a preceding `.` or word character, so an identifier such as
 * `sub.subscription.unsubscribe()` does not read as copy.
 */
export const FORBIDDEN_TEXT: readonly (readonly [label: string, pattern: RegExp])[] = [
  ['a currency figure', CURRENCY_FIGURE],
  ['the word upgrade', /(?<![.\w])upgrade\b/i],
  ['the word pricing', /(?<![.\w])pricing\b/i],
  ['subscribe/subscription', /(?<![.\w])subscri(be|ption)\b/i],
  ['a per-month price form', /\d\s*\/\s*(month|mo|mois)\b/i],
  ['the Pro plan name', /(?<![.\w])phare\s+pro\b/i],
];

// ── Compiled-bundle string extraction ───────────────────────────────────────

/**
 * Printable string runs out of a Hermes bytecode file.
 *
 * HERMES STORES STRINGS IN TWO ENCODINGS. A literal that is pure ASCII is
 * stored one byte per character; a literal with ANY non-ASCII character —
 * every accented French string, and every figure formatted with fr-CA's
 * U+00A0 separator — is stored as UTF-16LE. Verified on the 2026-09-15
 * export: "Try again" is present as ASCII, "Réessayer" only as UTF-16LE.
 * A byte grep sees the first and is blind to the second, which is to say
 * blind to the whole French catalogue.
 *
 * NOISE CONTROL. A UTF-16LE run is kept only if it contains at least one
 * non-ASCII character. Hermes never UTF-16-encodes a pure-ASCII string, so a
 * pure-ASCII UTF-16 run is by construction bytecode that happens to look like
 * one (little-endian small integers do). Runs shorter than `minLength` are
 * dropped for the same reason.
 */
export function extractStrings(bytes: Uint8Array, minLength = 6): string[] {
  const out: string[] = [];

  // One byte per character: printable ASCII.
  let run = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) {
      run += String.fromCharCode(b);
    } else {
      if (run.length >= minLength) out.push(run);
      run = '';
    }
  }
  if (run.length >= minLength) out.push(run);

  // UTF-16LE, at both byte alignments — a run can start on an odd offset.
  for (const start of [0, 1]) {
    let chars = '';
    let hasNonAscii = false;
    const flush = () => {
      if (chars.length >= minLength && hasNonAscii) out.push(chars);
      chars = '';
      hasNonAscii = false;
    };
    for (let i = start; i + 1 < bytes.length; i += 2) {
      const unit = bytes[i] | (bytes[i + 1] << 8);
      if (isPlausibleTextUnit(unit)) {
        chars += String.fromCharCode(unit);
        if (unit > 0x7e) hasNonAscii = true;
      } else {
        flush();
      }
    }
    flush();
  }

  return out;
}

/** Printable ASCII, Latin-1 + Latin Extended-A (French), general punctuation. */
function isPlausibleTextUnit(unit: number): boolean {
  return (
    (unit >= 0x20 && unit <= 0x7e) ||
    (unit >= 0xa0 && unit <= 0x17f) ||
    (unit >= 0x2000 && unit <= 0x206f) ||
    unit === 0x20ac
  );
}

export type Violation = { label: string; match: string; context: string };

/**
 * Every forbidden-pattern hit across a list of strings, except hits that sit
 * entirely inside an allowlisted sentence.
 *
 * An allowlist entry is a SENTENCE, not a word: the hit is excused only when
 * its span falls within an occurrence of that exact sentence. Whole-string
 * equality would be brittle — Hermes' string table packs literals end to end,
 * so a run's neighbours change from build to build — while a bare word would
 * excuse every future use of it. Every hit in a string is checked, not just
 * the first, so an excused library sentence cannot shadow a real price later
 * in the same run.
 */
export function findViolations(
  strings: readonly string[],
  allowlist: readonly string[] = []
): Violation[] {
  const violations: Violation[] = [];
  for (const s of strings) {
    for (const [label, pattern] of FORBIDDEN_TEXT) {
      const global = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
      for (const m of s.matchAll(global)) {
        const start = m.index;
        const end = start + m[0].length;
        if (allowlist.some((sentence) => insideOccurrence(s, sentence, start, end))) continue;
        violations.push({
          label,
          match: m[0],
          context: s.slice(Math.max(0, start - 40), end + 40),
        });
      }
    }
  }
  return violations;
}

function insideOccurrence(haystack: string, sentence: string, start: number, end: number): boolean {
  for (let at = haystack.indexOf(sentence); at !== -1; at = haystack.indexOf(sentence, at + 1)) {
    if (start >= at && end <= at + sentence.length) return true;
  }
  return false;
}

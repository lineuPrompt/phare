import { describe, it, expect } from 'vitest';
import { formatCADLocale } from '@phare/core';
import { CURRENCY_FIGURE, extractStrings, findViolations } from './complianceScan';

// The scanner is what every compliance check stands on — source, catalogue and
// compiled bundle. These pin both halves of its job: it must still SEE a price
// (including in the encoding Hermes uses for French), and it must NOT see one
// in the noise that made the old pattern unreadable.

const ascii = (s: string) => Array.from(Buffer.from(s, 'latin1'));
const utf16 = (s: string) => Array.from(Buffer.from(s, 'utf16le'));
const junk = [0x00, 0x13, 0xff, 0x02];

describe('CURRENCY_FIGURE', () => {
  it.each([
    '$15',
    'Only $150/year',
    '$ 15',
    '$15.00',
    '$5.00',
    '$1,234.50',
    '15 $',
    // The real fr-CA output, not a hand-typed lookalike: its separators are
    // U+00A0, which a plain-space literal here would silently not test.
    formatCADLocale(1234.5, 'fr'),
    '1\u202F234,50\u00A0$',
    '15,00 $',
  ])('matches the price %j', (text) => {
    expect(CURRENCY_FIGURE.test(text)).toBe(true);
  });

  it.each([
    ['a minifier suffix', 'getInstanceFromNode$1'],
    ['a two-digit minifier suffix', 'unstable_batchedUpdates$19mparse'],
    ['a regex backreference', "replace(re, '$1-$2')"],
    ['a template placeholder', '`${amount}`'],
    ['an escaped dollar', String.raw`\$15`],
  ])('does not match %s', (_label, text) => {
    expect(CURRENCY_FIGURE.test(text)).toBe(false);
  });
});

describe('extractStrings', () => {
  it('finds an ASCII string between bytecode bytes', () => {
    const bytes = Uint8Array.from([...junk, ...ascii('Upgrade for $15'), ...junk]);
    expect(extractStrings(bytes)).toContain('Upgrade for $15');
  });

  it('finds a UTF-16LE string at an even offset — how Hermes stores French', () => {
    const bytes = Uint8Array.from([...junk, ...utf16('Passez à Pro : 15 $'), ...junk]);
    expect(extractStrings(bytes)).toContain('Passez à Pro : 15 $');
  });

  it('finds a UTF-16LE string at an odd offset', () => {
    const bytes = Uint8Array.from([0x07, ...junk, ...utf16('Réessayer maintenant'), ...junk]);
    expect(extractStrings(bytes)).toContain('Réessayer maintenant');
  });

  it('drops a pure-ASCII UTF-16LE run, which Hermes never emits', () => {
    // Little-endian small integers decode as "$1$2$3…". Kept, they would be
    // exactly the bytecode noise the tightened pattern exists to avoid.
    const bytes = Uint8Array.from([...junk, ...utf16('$15 $15 $15'), ...junk]);
    expect(extractStrings(bytes)).toEqual([]);
  });

  it('drops runs shorter than the minimum length', () => {
    const bytes = Uint8Array.from([...junk, ...ascii('$15'), ...junk]);
    expect(extractStrings(bytes)).toEqual([]);
  });
});

describe('findViolations', () => {
  it('reports a price with its label', () => {
    const [v] = findViolations(['Upgrade for $15 today']);
    expect(v.label).toBe('a currency figure');
    expect(v.match).toBe('$15');
  });

  it('excuses a hit only inside the allowlisted sentence', () => {
    const allow = ['or upgrade the Realtime server'];
    expect(findViolations(['Please or upgrade the Realtime server now'], allow)).toEqual([]);
    // Same word, different sentence, same run: still reported.
    const hits = findViolations(['or upgrade the Realtime server. Upgrade to keep going'], allow);
    expect(hits.map((h) => h.label)).toEqual(['the word upgrade']);
    expect(hits[0].context).toContain('Upgrade to keep going');
  });

  it('reports every hit in a string, not just the first', () => {
    const hits = findViolations(['$15 a month, or $150 a year']);
    expect(hits.map((h) => h.match)).toEqual(['$15', '$150']);
  });
});

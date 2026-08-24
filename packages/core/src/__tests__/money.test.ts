import { describe, it, expect } from 'vitest';
import { formatCAD, formatCADLocale } from '../money';

// ---------------------------------------------------------------------------
// These tests PIN EXACT OUTPUT, byte for byte.
//
// formatCAD had zero test coverage before it moved into this package. It is
// pinned here not because the implementation is subtle — it is four lines —
// but because it depends on Intl.NumberFormat, whose output is supplied by the
// runtime's ICU data rather than by this repo. A runtime with different or
// absent ICU data changes these strings without changing a line of our code.
// Pinning them turns that from a silent rendering change into a red test.
//
// See README.md for the Hermes/React Native situation specifically.
// ---------------------------------------------------------------------------

// The fr-CA form uses U+00A0 NO-BREAK SPACE in two places: as the thousands
// separator, and between the amount and the dollar sign. A plain U+0020 (the
// ordinary space) renders near-identically and is exactly the difference a
// visual review misses.
//
// So it is constructed here from its codepoint rather than typed. Every byte
// of this source file is ASCII, which means no editor, formatter, copy-paste,
// or locale-aware tool can silently swap the character for an ordinary space
// and leave a test that still LOOKS correct while asserting the wrong thing.
const NBSP = String.fromCharCode(0xa0);

describe('formatCAD — en-CA, the shipped onboarding formatter', () => {
  it('formats a positive amount', () => {
    expect(formatCAD(1234.5)).toBe('$1,234.50');
  });

  it('formats a negative amount with a leading minus, before the symbol', () => {
    expect(formatCAD(-1234.5)).toBe('-$1,234.50');
  });

  it('formats zero with both decimal places', () => {
    expect(formatCAD(0)).toBe('$0.00');
  });

  it('groups thousands with a comma', () => {
    expect(formatCAD(1000000)).toBe('$1,000,000.00');
  });

  it('leaves a sub-thousand amount ungrouped', () => {
    expect(formatCAD(12.34)).toBe('$12.34');
  });

  it('uses ASCII separators throughout — no NBSP anywhere in the en-CA form', () => {
    // Asserted at codepoint level so a runtime that swapped in a narrow or
    // non-breaking space would fail loudly rather than produce a string that
    // merely looks right in a terminal.
    const out = formatCAD(1234.5);
    expect([...out].map((c) => c.codePointAt(0))).toEqual([
      0x24, // $
      0x31, // 1
      0x2c, // , ASCII COMMA
      0x32, 0x33, 0x34, // 234
      0x2e, // . ASCII FULL STOP
      0x35, 0x30, // 50
    ]);
    expect(out).not.toContain(NBSP);
  });

  it('IGNORES LOCALE ENTIRELY — the known fr bug, pinned deliberately', () => {
    // formatCAD takes no locale and always renders en-CA, so a French
    // onboarding user sees the en-CA string. This is a real, visible defect in
    // the primary market — see README Known Limitations. Pinned here so that
    // whoever fixes it must come through this test and delete it knowingly,
    // rather than meeting the behaviour by accident.
    expect(formatCAD(1234.5)).toBe('$1,234.50');
    expect(formatCAD(1234.5)).not.toBe(`1${NBSP}234,50${NBSP}$`);
  });
});

describe('formatCADLocale — fr-CA form, pinned at byte level', () => {
  it('formats a positive amount with NBSP grouping and a trailing NBSP + $', () => {
    expect(formatCADLocale(1234.5, 'fr')).toBe(`1${NBSP}234,50${NBSP}$`);
  });

  it('formats a negative amount', () => {
    expect(formatCADLocale(-1234.5, 'fr')).toBe(`-1${NBSP}234,50${NBSP}$`);
  });

  it('formats zero — no grouping separator, but still an NBSP before $', () => {
    expect(formatCADLocale(0, 'fr')).toBe(`0,00${NBSP}$`);
  });

  it('groups every thousands boundary with its own NBSP', () => {
    expect(formatCADLocale(1000000, 'fr')).toBe(`1${NBSP}000${NBSP}000,00${NBSP}$`);
  });

  it('uses a comma as the DECIMAL separator, not a full stop', () => {
    expect(formatCADLocale(12.34, 'fr')).toBe(`12,34${NBSP}$`);
  });

  it('proves the separators are U+00A0 and not U+0020, by codepoint', () => {
    const out = formatCADLocale(1234.5, 'fr');
    expect([...out].map((c) => c.codePointAt(0))).toEqual([
      0x31,             // 1
      0xa0,             // NO-BREAK SPACE — thousands separator, NOT 0x20
      0x32, 0x33, 0x34, // 234
      0x2c,             // , decimal comma
      0x35, 0x30,       // 50
      0xa0,             // NO-BREAK SPACE — before the symbol, NOT 0x20
      0x24,             // $
    ]);
    // Stated as standalone claims too, so a failure reads plainly.
    expect(out).not.toContain(' ');          // no ASCII space anywhere
    expect(out.split(NBSP)).toHaveLength(3); // exactly two NBSPs
  });

  it('falls back to en-CA for any non-fr locale, matching the three formatCurrency copies', () => {
    expect(formatCADLocale(1234.5, 'en')).toBe('$1,234.50');
    expect(formatCADLocale(1234.5, 'de')).toBe('$1,234.50');
    expect(formatCADLocale(1234.5, '')).toBe('$1,234.50');
  });

  it('agrees with formatCAD whenever the locale is not fr', () => {
    for (const amount of [0, 12.34, -1234.5, 1000000]) {
      expect(formatCADLocale(amount, 'en')).toBe(formatCAD(amount));
    }
  });
});

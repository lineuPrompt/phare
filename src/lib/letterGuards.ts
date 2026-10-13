// ---------------------------------------------------------------------------
// GUARDS ON A GENERATED LETTER (2026-10-10).
//
// The AI only narrates figures that code computed (CLAUDE.md §4). Until now
// the review's prompt said so and nothing checked it. September 2026's letter
// for a real household contained "$2,451", a sum the model made by adding four
// lines, two of them card payments, and called "food spending".
//
// 1. FIGURES. Every dollar amount in the letter must be a number present in
//    the payload the model was given:
//      - written WITH cents ("$192.31", « 192,31 $ »): equal to a payload
//        figure, to the cent;
//      - written as whole dollars ("$192", « 192 $ »): equal to a payload
//        figure rounded to the nearest dollar, x.50 up (2026-10-11 — the
//        model rounds $192.31 to "$192" despite the prompt, and that is
//        formatting, not a new number).
//    A figure the model MADE is still refused either way: "roughly $2,451"
//    was four lines added together, and no single payload figure is 2,451
//    or rounds to it. Percentages are refused outright: the payload carries
//    dollars only, so no percentage in a letter can be a figure code
//    computed.
//
// 2. NAMES. Every card or spending category the letter names must be one the
//    payload's "cards" section carries. Replaces the category-sourcing check
//    (findUnsanctionedSourcingMention), which allowed exactly one category and
//    only looked near phrases like "could come from". The letter may now name
//    any card or category it was given, and no other.
//
// Both are pure. The caller decides what a failure means; for the monthly
// review: regenerate once, then fail visibly and save nothing.
// ---------------------------------------------------------------------------

/** `hasCents`: written with a decimal part, so it must match to the cent. */
export type DollarFigure = { raw: string; cents: number; hasCents: boolean };

const DIGITS_EN = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const DIGITS_FR = String.raw`\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?`;

// "$1,234.56", "$ 1234", "-$12.50", "−$12.50" — the sign is ignored (a balance
// of −115.34 may be written "$115.34 below zero").
const EN_FIGURE = new RegExp(String.raw`[-−]?\$\s?(${DIGITS_EN})(?![\d.,]*\d|\s?[kKmM]\b)`, 'g');
// "1 234,56 $" with U+00A0, U+202F or a plain space, as fr-CA writes it.
const FR_FIGURE = new RegExp(String.raw`(?<![\d,.])(${DIGITS_FR})[ \u00A0\u202F]?\$`, 'g');
// A figure written with a word instead of a sign.
const WORD_FIGURE = new RegExp(String.raw`(?<![\d,.$])(${DIGITS_EN})\s+(?:dollars?|CAD)\b`, 'gi');
// "1.2k", "$2K" — never a figure code computed.
const ABBREVIATED = /\$\s?\d+(?:[.,]\d+)?\s?[kKmM]\b/g;
const PERCENT = /\d+(?:[.,]\d+)?\s?(?:%|per\s?cent\b|pour\s?cent\b)/gi;

function toCentsEn(digits: string): number {
  return Math.round(Number(digits.replace(/,/g, '')) * 100);
}

function toCentsFr(digits: string): number {
  return Math.round(Number(digits.replace(/[ \u00A0\u202F]/g, '').replace(',', '.')) * 100);
}

/** Every dollar amount written in the text, in cents (sign dropped). */
export function extractDollarFigures(text: string): DollarFigure[] {
  const out: DollarFigure[] = [];
  for (const m of text.matchAll(EN_FIGURE)) out.push({ raw: m[0], cents: toCentsEn(m[1]), hasCents: m[1].includes('.') });
  for (const m of text.matchAll(FR_FIGURE)) out.push({ raw: m[0], cents: toCentsFr(m[1]), hasCents: m[1].includes(',') });
  for (const m of text.matchAll(WORD_FIGURE)) out.push({ raw: m[0], cents: toCentsEn(m[1]), hasCents: m[1].includes('.') });
  return out;
}

/** Every number anywhere in the payload, as absolute cents. */
export function payloadCents(payload: unknown): Set<number> {
  const set = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) set.add(Math.abs(Math.round(v * 100)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(payload);
  return set;
}

export type FigureGuardResult = { ok: boolean; offending: string[] };

/** Each payload figure rounded to the nearest whole dollar (x.50 up), in cents. */
export function payloadWholeDollars(exactCents: Set<number>): Set<number> {
  return new Set([...exactCents].map((c) => Math.floor((c + 50) / 100) * 100));
}

export function checkLetterFigures(text: string, payload: unknown): FigureGuardResult {
  const exact = payloadCents(payload);
  const whole = payloadWholeDollars(exact);
  const offending = [
    ...extractDollarFigures(text)
      .filter((f) => !(f.hasCents ? exact.has(f.cents) : whole.has(f.cents)))
      .map((f) => f.raw.trim()),
    ...[...text.matchAll(ABBREVIATED)].map((m) => m[0].trim()),
    ...[...text.matchAll(PERCENT)].map((m) => m[0].trim()),
  ];
  return { ok: offending.length === 0, offending: [...new Set(offending)] };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameRegExp(name: string): RegExp {
  // A name is a whole run of letters and digits: "Shopping" never matches
  // inside "Shoppings", and accented French names bound correctly.
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(name)}(?![\p{L}\p{N}])`, 'gu');
}

/**
 * Names of the household's cards and categories that the letter uses but the
 * payload's cards do not carry. Case-sensitive, as the names are written: the
 * prompt asks for names exactly as given, and a lower-case common word
 * ("unexpected") is prose, not the category "Unexpected".
 *
 * An allowed name's own occurrences are masked first, so a known name inside
 * an allowed one ("Costco" inside the allowed card "Costco Lineu") is not a
 * violation.
 */
export function findNamesNotInPayload(text: string, knownNames: string[], allowedNames: string[]): string[] {
  const allowed = new Set(allowedNames.map((n) => n.trim()).filter(Boolean));
  let masked = text;
  for (const name of [...allowed].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(nameRegExp(name), (m) => ' '.repeat(m.length));
  }
  const found: string[] = [];
  for (const name of new Set(knownNames.map((n) => n.trim()).filter(Boolean))) {
    if (allowed.has(name)) continue;
    if (nameRegExp(name).test(masked)) found.push(name);
  }
  return found;
}

/** Thrown when a letter fails a guard twice. Carries what failed, for the event and the cron report. */
export class LetterGuardError extends Error {
  readonly figures: string[];
  readonly names: string[];
  constructor(figures: string[], names: string[]) {
    super(
      `letter failed its guards: ${[
        figures.length ? `figures not in the payload: ${figures.join(', ')}` : '',
        names.length ? `names not in the payload's cards: ${names.join(', ')}` : '',
      ].filter(Boolean).join('; ')}`
    );
    this.name = 'LetterGuardError';
    this.figures = figures;
    this.names = names;
  }
}

// ---------------------------------------------------------------------------
// Manual entry — reading what a person typed into an amount field, and
// whether an entry form may be submitted.
// ---------------------------------------------------------------------------

/**
 * Integer part capped at nine digits: $999,999,999.99 is far past any real
 * household figure. Past it, the input is refused, never clipped.
 */
const AMOUNT_PATTERN = /^(-?)(\d{1,9})(?:[.,](\d{1,2}))?$/;

/**
 * A typed amount → a number, or null when it cannot be read EXACTLY.
 *
 * WHY THIS EXISTS. On an iPhone set to French (Canada), the decimal keypad's
 * separator key types a comma: "12,50". `parseFloat('12,50')` is 12 — it stops
 * at the comma and returns what it has, silently. A household would record
 * $12 for a $12.50 purchase and nothing on screen would say so.
 *
 * THE RULE, locale-independent on purpose:
 *   - digits, optionally one decimal separator ('.' or ',') followed by one
 *     or two digits, optionally a leading '-';
 *   - surrounding whitespace is ignored;
 *   - ANYTHING else is null. No thousands separators, no currency sign, no
 *     third decimal, no second separator, no trailing separator.
 *
 * Accepting either separator in either locale is safe only because grouping
 * is refused: with at most two digits after it, a lone separator can only be
 * a decimal point. "1,234" (three digits after) is therefore rejected rather
 * than guessed at — in English it means one thousand, in French it is not a
 * valid amount, and the parser has no business picking one.
 *
 * Returns the value; whether it must be positive is the caller's rule.
 */
export function parseAmountInput(raw: string): number | null {
  const m = AMOUNT_PATTERN.exec(raw.trim());
  if (!m) return null;
  const [, sign, whole, fraction] = m;
  const value = Number(`${sign}${whole}.${fraction ?? '0'}`);
  if (!Number.isFinite(value)) return null;
  // -0 reads as "0" everywhere a person sees it; do not hand out a signed zero.
  return value === 0 ? 0 : value;
}

/**
 * Whether a manual-entry form may be submitted.
 *
 * `amount` is already parsed — the web form passes parseFloat of its number
 * input, the mobile form passes parseAmountInput's result. NaN and null both
 * fail the > 0 test.
 *
 * Category is required only for money out (on a card, money in is a refund and
 * the web form also asks for one, but does not require it). An account must be
 * chosen only when there is more than one to choose from.
 *
 * This is a convenience gate for the button, never a substitute for the
 * server's validation.
 */
export function canSaveExpense(input: {
  description: string;
  amount: number | null;
  entryType: 'expense' | 'income';
  categoryId: string;
  accountCount: number;
  selectedAccountId: string;
}): boolean {
  return Boolean(
    input.description.trim()
      && input.amount !== null && input.amount > 0
      && (input.entryType === 'income' || input.categoryId)
      && (input.accountCount <= 1 || input.selectedAccountId)
  );
}

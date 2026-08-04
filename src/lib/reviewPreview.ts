// ---------------------------------------------------------------------------
// The free-tier review preview.
//
// The monthly review is the conversion mechanic: free households see the
// opening, Pro households see all of it. The cut therefore has to leave
// something that reads like a deliberate excerpt rather than a truncation
// accident — a sentence that stops mid-clause reads as a bug, and a bug is not
// a persuasive reason to pay.
//
// TRUNCATION HAPPENS ON THE SERVER. The full text must never reach a free
// client, or the paywall is a CSS effect that anyone can defeat from the
// network tab. This module is called by the dashboard route before the response
// is built; the component only renders what it was given.
// ---------------------------------------------------------------------------

/**
 * Target length of the preview, in characters, before backing up to a sentence
 * boundary. Roughly one paragraph of the four the review prompt asks for.
 */
export const REVIEW_PREVIEW_CHARS = 320;

export type ReviewPreview = {
  /** What a free household receives. Identical to the input when not truncated. */
  text: string;
  /** True when text was shortened — drives the lock UI, never inferred by length. */
  truncated: boolean;
};

/**
 * Sentence terminator followed by whitespace or end-of-string.
 *
 * The trailing-whitespace requirement is what stops the cut landing inside a
 * money figure: "$1,500.50" has a period, but it is followed by a digit, so it
 * is not a sentence end. Reviews are full of amounts, so this is the common
 * case rather than an edge case.
 */
const SENTENCE_END = /[.!?…](?=\s|$)/g;

/**
 * Cuts `full` to a preview at a sentence boundary.
 *
 * Never cuts mid-word. If no sentence boundary exists within the budget it
 * falls back to the last whitespace, and only if there is no whitespace at all
 * does it cut hard — a single 400-character "word" is not prose, and returning
 * the whole thing would leak the full review.
 */
export function previewOfReview(
  full: string | null | undefined,
  maxChars: number = REVIEW_PREVIEW_CHARS
): ReviewPreview {
  if (!full) return { text: '', truncated: false };

  const text = full.trim();
  if (text.length <= maxChars) return { text, truncated: false };

  // Find the last sentence end at or before the budget.
  const window = text.slice(0, maxChars + 1);
  let lastEnd = -1;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(window)) !== null) {
    lastEnd = m.index;
  }

  if (lastEnd > 0) {
    return { text: text.slice(0, lastEnd + 1).trim(), truncated: true };
  }

  // No sentence boundary in range — fall back to a word boundary so the preview
  // still ends on a whole word.
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > 0) {
    return { text: text.slice(0, lastSpace).trim() + '…', truncated: true };
  }

  return { text: text.slice(0, maxChars).trim() + '…', truncated: true };
}

/**
 * What the dashboard route returns for the review, given entitlement.
 *
 * Kept here rather than inline in the route so the "Pro sees everything, free
 * sees a preview" rule has exactly one implementation, and so the route cannot
 * accidentally return `review` and `reviewLocked` that disagree with each other.
 */
export function reviewForEntitlement(
  full: string | null | undefined,
  isProHousehold: boolean
): { review: string | null; reviewLocked: boolean } {
  if (!full) return { review: null, reviewLocked: false };
  if (isProHousehold) return { review: full, reviewLocked: false };

  const { text, truncated } = previewOfReview(full);
  return { review: text, reviewLocked: truncated };
}

import type { LegalDocument } from '@phare/core';

// ---------------------------------------------------------------------------
// A legal document (the Privacy Policy, from @phare/core) as the flat list of
// blocks the Privacy screen draws, in reading order. Pure, so what the screen
// shows is testable without a React Native renderer: every paragraph of the
// document must come out as exactly one block, nothing dropped or added.
// ---------------------------------------------------------------------------

export type LegalBlock =
  | { kind: 'title'; text: string }
  | { kind: 'updated'; date: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string };

export function legalBlocks(doc: LegalDocument): LegalBlock[] {
  return [
    { kind: 'title', text: doc.title },
    { kind: 'updated', date: doc.lastUpdated },
    ...(doc.intro ?? []).map((text) => ({ kind: 'paragraph' as const, text })),
    ...doc.sections.flatMap((section) => [
      { kind: 'heading' as const, text: section.heading },
      ...section.body.map((text) => ({ kind: 'paragraph' as const, text })),
    ]),
  ];
}

/**
 * `**bold**` is the documents' only markup (the web renders it as <strong>).
 * Splits a paragraph into runs; an unmatched `**` is kept as literal text
 * rather than swallowing the rest of the paragraph.
 */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs;
}

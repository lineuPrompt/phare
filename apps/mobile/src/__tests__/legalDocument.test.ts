import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVACY_POLICY } from '@phare/core';
import { boldRuns, legalBlocks } from '../lib/legalDocument';

// The Privacy screen draws legalBlocks(PRIVACY_POLICY[locale]). These pin that
// every paragraph of the real document becomes exactly one block, in order.

describe('legalBlocks — the Privacy Policy, whole and in order', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`${locale}: title, date, every intro paragraph, every heading and paragraph — nothing dropped`, () => {
      const doc = PRIVACY_POLICY[locale];
      const blocks = legalBlocks(doc);
      const paragraphs = (doc.intro ?? []).length + doc.sections.reduce((n, s) => n + s.body.length, 0);
      expect(blocks[0]).toEqual({ kind: 'title', text: doc.title });
      expect(blocks[1]).toEqual({ kind: 'updated', date: doc.lastUpdated });
      expect(blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text))
        .toEqual(doc.sections.map((s) => s.heading));
      expect(blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(paragraphs);
      expect(blocks).toHaveLength(2 + doc.sections.length + paragraphs);
    });
  }
});

describe('boldRuns', () => {
  it('splits **bold** runs and keeps the rest', () => {
    expect(boldRuns('Write to **support@phare.money**. A person reads it.')).toEqual([
      { text: 'Write to ', bold: false },
      { text: 'support@phare.money', bold: true },
      { text: '. A person reads it.', bold: false },
    ]);
  });

  it('leaves an unmatched ** as text instead of swallowing the paragraph', () => {
    expect(boldRuns('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
  });

  it('every paragraph of the policy loses only its ** markers', () => {
    for (const doc of Object.values(PRIVACY_POLICY)) {
      for (const block of legalBlocks(doc)) {
        if (block.kind !== 'paragraph') continue;
        expect(boldRuns(block.text).map((r) => r.text).join('')).toBe(block.text.replace(/\*\*/g, ''));
      }
    }
  });
});

describe('/diagnostics is development-only', () => {
  // No React Native renderer here, so this reads the route source: the
  // production branch must redirect before the screen module is required.
  it('redirects when not __DEV__, before requiring the screen, and never imports it at the top', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'diagnostics.tsx'), 'utf8');
    const guard = src.indexOf("if (!__DEV__) return <Redirect href=\"/\" />;");
    const req = src.indexOf("require('../src/screens/DiagnosticsScreen')");
    expect(guard).toBeGreaterThan(-1);
    expect(req).toBeGreaterThan(guard);
    expect(src).not.toMatch(/^import .*DiagnosticsScreen/m);
  });
});

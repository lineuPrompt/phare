# Card plan editor: three hardcoded English strings

**Filed** 2026-09-29, found while adding the later-plans question to the
editor.

**Status:** OPEN.

**Severity:** low. French households see English (CLAUDE.md §4 bilingual rule).
`i18nKeys.test.ts` cannot see literals, which is why these survived.

In [src/components/cards/CardEnvelopeEditor.tsx](../../src/components/cards/CardEnvelopeEditor.tsx):

- ~line 266: `Allocated: {formatCurrency(...)}` — rendered on every open.
- ~line 95: `setError('Enter a valid monthly goal.')`.
- ~line 141: fallback `'Failed to save.'`, and `d.error` itself is the
  server's English message. Show the server's reason (never hide it), but
  inside a localized frame.

## The fix

Move all three to `cards.editor.*` in both catalogues, native French.
Extend `src/components/cards/__tests__/envelopeEditorRender.test.tsx` to
render in `fr` and assert "Allocated" is absent.

# Sign-in link errors are English only

**Filed** 2026-10-20, found while fixing launch plan 1.5 (invite opened where
someone else is signed in).

**Status:** OPEN. P2.

---

## The problem

When an emailed link (invite, password reset) fails, `/auth/callback` sends
the person to `/en/signin?error=...`, and `src/app/[locale]/signin/page.tsx`
(lines ~130–137) renders:

- `no_tokens` → a hardcoded English sentence
- `link_expired` → a hardcoded English sentence
- anything else → the raw text of the error, as-is. That is the auth server's
  English message (e.g. "Invalid Refresh Token: Already Used") or, since 1.5,
  "The sign-in link did not match the account it was sent for".

So a French household sees English here, always, and the callback hardcodes
`/en/` even when `next` says `/fr/` (`localeFromNext` is already available).
`i18nKeys.test.ts` cannot see these: they are literals, not `t()` keys.

## The fix (proposed)

- The callback redirects to `/${localeFromNext(next)}/signin?error=<code>`
  with a small set of codes (`no_tokens`, `link_expired`, `link_mismatch`,
  `session_failed`), logging the server's real message to the console as it
  does now.
- The sign-in page maps each code to a `t()` key in both catalogues; an
  unknown code shows a generic localized line plus the code itself, so the
  real reason stays visible.

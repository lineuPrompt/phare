# @phare/mobile

The Expo app. **This is a scaffold — a walking skeleton, not V1.** It proves the
whole chain works end to end on a device: startup probe → sign-in → an
authenticated API call → `@phare/core` rendering the result, bilingually.

What it deliberately does **not** contain: the card room, Timeline, expense
entry, onboarding, billing. None of that is started.

## Running it

`pnpm` only — `npm` is blocked by the repo's `preinstall` guard.

```bash
# from the repo root
pnpm install

# one-time: point the app at Supabase and the API
cp apps/mobile/.env.example apps/mobile/.env.local
#   then fill in the two Supabase values (same as the web app's
#   NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY) and set EXPO_PUBLIC_API_URL

# build and install a DEVELOPMENT BUILD on a connected device
cd apps/mobile
pnpm exec expo run:android      # needs Android Studio + a JDK
pnpm exec expo run:ios          # needs macOS + Xcode

# subsequent runs — the dev server only
pnpm --filter @phare/mobile start
```

**Not Expo Go.** `expo-dev-client` is a dependency and the app is built as a
development build, because Universal Links / App Links cannot be tested in Expo
Go — it registers its own URL scheme, not `money.phare.app`'s.

`EXPO_PUBLIC_*` values are **inlined by Metro at build time**. Changing
`.env.local` while the bundler is running has no effect; restart it.

## Checks

```bash
pnpm --filter @phare/mobile test        # vitest — pure logic only
pnpm --filter @phare/mobile typecheck   # tsc --noEmit
pnpm --filter @phare/mobile bundle      # a real Metro production bundle
pnpm exec eslint apps/mobile            # from the repo root
```

The test suite is **separate from the repo root's**, on purpose — see the
comment at the top of `vitest.config.ts`. The root suite's number is the web
app's, and it must not move when mobile changes.

Nothing here renders a React Native component: that needs a device or a native
test renderer, and neither belongs in a scaffold. What is tested is the logic
that can be wrong without a device — catalogue parity, message lookup and
interpolation, API error classification, and App Store compliance over the
source.

## The three things worth knowing

### 1. `assertTimeZoneSupport()` gates the whole app

`src/lib/startupProbe.ts` runs it at **module-evaluation time**, and
`app/_layout.tsx` imports that module first. If it fails, `TimeZoneErrorScreen`
*is* the app — no navigator, no route past it, no "continue anyway".

That severity is deliberate and `packages/core/README.md` explains why: a
runtime without full ICU does not reject `Intl.DateTimeFormat`'s `timeZone`
option, it **accepts and ignores it**. Dates keep coming back well-formed and
merely wrong near midnight, so a January transaction is booked into February
with no error anywhere. A way past that screen would be a way to corrupt a
household's ledger quietly.

### 2. `@phare/core` needs no build step and no Metro config

The package ships raw TypeScript (`exports` → `./src/index.ts`, no `dist/`).
Metro consumes it across the pnpm symlink with **zero configuration** — there is
no `metro.config.js` in this app and none is needed. Verified by bundling and
then grepping the compiled Hermes output for the package's own strings.

Do not add a build step to `@phare/core` to "fix" mobile. Nothing is broken, and
that change would affect the web app too.

### 3. No prices. Ever. From the first commit.

App Store Review Guideline 3.1.1: an iOS app may not steer users toward an
external purchase mechanism, and Phare sells through Stripe on the web. So this
bundle carries **no price, no plan name, no upgrade button, no pricing link, and
no steering copy** — and `src/__tests__/sourceCompliance.test.ts` fails the build
if any appears.

This is also why the app has **its own** message catalogues rather than reusing
`src/messages/*.json`: the web files contain `"$15"`, `"$150/year"` and
`"Upgrade to Phare Pro"`, and importing them would compile those strings into
the shipped binary whether or not a screen ever rendered them.

`isPro` and `reviewLocked` are read from the server, which truncates a free
household's letter **before** the payload is sent. `LockedNotice` states that
fact and offers no route anywhere.

## Layout

```
app/                    expo-router routes
  _layout.tsx           time-zone gate, i18n provider, Stack
  index.tsx             auth gate: SignInScreen or ReviewScreen
  diagnostics.tsx       dev-only device report (see below)
src/
  i18n/                 catalog.ts (pure), index.tsx (React), messages/{en,fr}.json
  lib/                  env, supabase, api, apiErrors, reviews, useSession, startupProbe
  screens/              TimeZoneError, SignIn, Review, Diagnostics
  components/           LockedNotice
```

## The diagnostics screen

`/diagnostics`, linked from the bottom of the review screen. It is **not a
product surface** and should be dropped or gated behind `__DEV__` before the app
reaches anyone who is not building it.

It exists because one question can only be answered on real hardware: does
Hermes honour `Intl`? The screen shows the probe verdict, `formatCAD` and
`formatCADLocale` for both locales **with their codepoints** (the fr-CA form is
correct only if the separators are U+00A0, which is visually identical to a
plain space), `businessToday('America/Toronto')`, and a button that calls
`/api/review-stream?stream=0` to confirm React Native's `fetch` can read a
non-streamed body.

That last button **spends Anthropic tokens** on every press. It is manual for
that reason.

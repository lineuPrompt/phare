# apps/mobile/app.json hardcodes identifiers the web reads from env

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN.

---

## The problem

The web's well-known routes already read the app identifiers from env:
[apple-app-site-association](../../src/app/api/well-known/apple-app-site-association/route.ts)
uses `APPLE_TEAM_ID` + `APPLE_BUNDLE_ID`, and
[assetlinks](../../src/app/api/well-known/assetlinks/route.ts) uses
`ANDROID_PACKAGE_NAME`. The app side does not:
[apps/mobile/app.json](../../apps/mobile/app.json) hardcodes
`bundleIdentifier` and `package` as `money.phare.app`.

So the same identifier lives as an env value on Vercel and as a literal in
the app. If they ever differ, Universal Links / App Links fail silently —
phare.money links open Safari instead of the app, with no error anywhere.

## The fix

Convert `app.json` to `app.config.ts` that reads the bundle id and Android
package from env under the **same variable names** the web uses, and refuses
to build when either is missing (the fail-loud rule of
`apps/mobile/src/lib/env.ts`). Set them in the EAS build profiles.

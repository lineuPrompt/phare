import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Apple App Site Association — the file iOS fetches to decide whether a
// phare.money link opens the app instead of Safari.
//
// Served here rather than from public/ for one reason: Apple requires
// Content-Type: application/json, and the file must have NO extension. A
// file in public/ with no extension is served as application/octet-stream,
// which Apple's CDN rejects — and it rejects it silently, months after you
// stopped looking at it. A route handler is the only way to state the
// content type outright.
//
// Reached at /.well-known/apple-app-site-association via a REWRITE in
// next.config.ts, never a redirect. Apple's CDN does not follow redirects
// when fetching this file; a 301 here is indistinguishable from the file not
// existing. The rewrite is internal, so the response is a 200 at the
// well-known path.
//
// It also has to dodge the i18n proxy. src/proxy.ts matches
// '/((?!api|trpc|_next|_vercel|.*\\..*).*)' — the '.*\\..*' clause excludes
// any path containing a dot, and '.well-known' contains one, so the
// well-known path is never rewritten to /en/... . (This is why the file must
// live under /.well-known/ and not at the legacy root location: a root
// /apple-app-site-association has no dot, WOULD be matched by the proxy, and
// WOULD be redirected to /en/apple-app-site-association. Apple would see a
// redirect and give up.)
//
// FAILS CLOSED. Without a configured Team ID and bundle ID this 404s rather
// than serving a file with a placeholder in it. That is deliberate: Apple's
// CDN caches this aggressively, and a wrong appID cached for days is far
// worse to debug than an absent file.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/**
 * Paths the app is allowed to claim.
 *
 * DELIBERATELY NARROW. Whatever is listed here stops being a web page for
 * anyone who has the app installed — iOS opens the app instead. Claiming '/'
 * or '/*' would mean the landing page, pricing, the FAQ and both legal pages
 * silently stop being reachable from a link for exactly the people most
 * likely to share them.
 *
 * So this claims only the auth landing, which is the one URL a user follows
 * from an email expecting to end up signed in:
 *   - /auth/callback — what every redirectTo in the codebase actually emits
 *     (forgot-password, member invite, member resend all build
 *     `${appOrigin}/auth/callback?next=...`)
 *   - /en/auth/callback, /fr/auth/callback — the post-proxy shape, claimed
 *     only so a link copied out of a browser address bar behaves the same.
 *     iOS matches the URL as sent, before any server redirect, so these are
 *     belt-and-braces rather than the live path.
 */
const CLAIMED_PATHS = ['/auth/callback', '/en/auth/callback', '/fr/auth/callback'];

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;

  if (!teamId || !bundleId) {
    console.error(
      'AASA — APPLE_TEAM_ID / APPLE_BUNDLE_ID not set; refusing to serve a placeholder association file.'
    );
    return new NextResponse('Not configured', { status: 404 });
  }

  const body = {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          // The `components` form (iOS 13+) rather than the legacy `paths`
          // array — it is what Apple documents now, and it lets the query
          // string be matched explicitly. `?: { '*': '*' }` keeps the
          // ?next=/en/dashboard param that every redirectTo attaches from
          // disqualifying the match.
          components: [
            ...CLAIMED_PATHS.map((path) => ({
              '/': path,
              '?': { '*': '*' },
              comment: 'Password reset and member invite landing',
            })),
          ],
        },
      ],
    },
    // No `webcredentials` and no `appclips`. webcredentials would enable
    // shared-web-credentials / password autofill against phare.money — worth
    // adding later, but it is a separate decision from link routing and
    // turning it on here would be an unannounced change to how passwords are
    // stored on device.
  };

  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      // Apple's CDN caches this for its own reasons; a short max-age keeps a
      // correction from taking a day to propagate through intermediaries.
      'Cache-Control': 'public, max-age=300',
    },
  });
}

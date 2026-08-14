import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Digital Asset Links — Android's counterpart to the AASA file. Reached at
// /.well-known/assetlinks.json via a rewrite in next.config.ts.
//
// Android is less fussy than Apple (assetlinks.json HAS a .json extension, so
// a file in public/ would get the right content type on its own), but this is
// a route handler for the same reason the AASA one is: the signing
// fingerprint is not knowable until EAS has built the app, and it CHANGES
// between the local development build and the Play-signed release. Reading it
// from an env var means the value arrives without a code change or a redeploy
// of anything else.
//
// THE FINGERPRINT THAT MATTERS IS GOOGLE'S, NOT YOURS. With Play App Signing
// on (the default for new apps), Google re-signs the upload with its own key.
// The fingerprint Android verifies against is the one in
// Play Console → Test and release → Setup → App signing → "App signing key
// certificate", NOT the upload key and NOT the one EAS prints after a build.
// Using the upload key's fingerprint here is the single most common reason
// App Links silently fail in production while working perfectly in testing.
//
// Hence the comma-separated list: during development you will want BOTH the
// EAS development-build fingerprint and the Play signing fingerprint present,
// so the same deployed file verifies for both.
//
// FAILS CLOSED, same as the AASA route — an unconfigured deployment 404s
// rather than publishing an assetlinks file that claims the wrong app.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export async function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME;
  const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

  if (!packageName || fingerprints.length === 0) {
    console.error(
      'assetlinks — ANDROID_PACKAGE_NAME / ANDROID_SHA256_FINGERPRINTS not set; refusing to serve a placeholder.'
    );
    return new NextResponse('Not configured', { status: 404 });
  }

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },

  // -------------------------------------------------------------------------
  // Deep-link association files.
  //
  // REWRITES, never redirects. Apple's CDN does not follow redirects when it
  // fetches the association file, and Android's verifier is no more patient —
  // a 301 at either path reads as "this site does not claim that app". A
  // rewrite is internal, so both paths answer 200 with the real body.
  //
  // The handlers live under /api/well-known/ so they inherit the one thing
  // that matters besides the status code: src/proxy.ts excludes /api from the
  // i18n middleware, so neither file can be rewritten to /en/... on its way
  // out. The public /.well-known/ paths are excluded from that middleware too
  // (its matcher drops any path containing a dot, and '.well-known' has one),
  // so the request bypasses next-intl on both sides of the rewrite.
  // -------------------------------------------------------------------------
  async rewrites() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/api/well-known/apple-app-site-association',
      },
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/well-known/assetlinks',
      },
    ];
  },
});
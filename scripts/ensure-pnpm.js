/**
 * Refuse installs from any package manager except pnpm.
 *
 * WHY THIS EXISTS: this repo once tracked both package-lock.json and
 * pnpm-lock.yaml. An `npm install` updated the npm lockfile, left
 * pnpm-lock.yaml stale, looked completely fine locally — and broke the Vercel
 * build, which installs with pnpm and --frozen-lockfile. The failure surfaced
 * far from its cause.
 *
 * WHY A FILE RATHER THAN AN INLINE `node -e` IN package.json: the inline
 * version needs escaped newlines inside a JSON string, and those survive npm's
 * shell but NOT pnpm's — the guard itself threw a SyntaxError during
 * `pnpm install`, which would have broken the very build it was added to
 * protect. A file has no escaping to get wrong.
 *
 * WHY NOT `npx only-allow pnpm`: it is the conventional choice, but it fetches
 * from the registry during preinstall, making every CI install depend on a
 * network round trip. This check needs nothing.
 *
 * npm, pnpm and yarn all set npm_config_user_agent. Anything that sets no user
 * agent at all is not a package manager install (a direct `node` invocation,
 * some editor tooling), so it is allowed through rather than blocking a
 * context this was never meant to police.
 */
const ua = process.env.npm_config_user_agent || '';

if (ua && !ua.startsWith('pnpm')) {
  const tool = ua.split('/')[0] || 'this tool';
  console.error('');
  console.error(`  This repo is pnpm-only, but the install was started by ${tool}.`);
  console.error('');
  console.error('    Use:  pnpm install');
  console.error('');
  console.error('  npm would write package-lock.json, which CI ignores. That exact');
  console.error('  mismatch broke a deploy once — the build installs with pnpm and');
  console.error('  --frozen-lockfile, so a stale pnpm-lock.yaml fails hard.');
  console.error('');
  process.exit(1);
}

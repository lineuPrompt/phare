import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// THE REAL ANTHROPIC CLIENT IS OPT-IN, NOT OPT-OUT.
//
// Every test that can reach src/lib/anthropic.ts mocks it today. That is a
// CONVENTION, and a convention holds right up until someone adds a test,
// imports a route that transitively pulls in monthlyReviewService, and forgets
// the vi.mock. The failure mode is not a red test — it is a real, billed
// claude-sonnet-4-6 call, possibly in CI, possibly on every push.
//
// So the default is inverted here: the client is replaced suite-wide, and any
// call to it THROWS with an explanation. Forgetting to mock now produces a
// loud, free test failure instead of a silent charge.
//
// PER-FILE MOCKS STILL WIN. A test file's own `vi.mock('@/lib/anthropic', …)`
// is registered when that file is evaluated, which is after this setup runs,
// so it replaces this one. Nothing in the existing suite changes.
//
// THE ESCAPE HATCH IS COMPARE_REVIEW=1 — deliberately the SAME variable the
// live comparison test already requires, so that exactly one environment
// variable means "this run is allowed to spend money", rather than two that
// have to be remembered together. With it set, this returns the genuine module
// and real calls go through.
//
// Note that opting in here is necessary but NOT sufficient to run the live
// comparison test: that file carries its own two locks (`describe.skip` and an
// in-body throw). See src/lib/__tests__/liveReviewComparison.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@/lib/anthropic', async (importOriginal) => {
  if (process.env.COMPARE_REVIEW === '1') {
    // Deliberate opt-in: hand back the real client, untouched.
    return await importOriginal<typeof import('@/lib/anthropic')>();
  }

  const refuse = () => {
    throw new Error(
      'A test tried to call the REAL Anthropic API. This is blocked suite-wide ' +
      'by vitest.setup.ts because a real call costs money.\n\n' +
      'If this is your test: add a vi.mock for @/lib/anthropic at the top of ' +
      'the file, the way the other AI-path tests do (see ' +
      'src/app/api/plan/__tests__/route.test.ts).\n\n' +
      'If you genuinely mean to spend money, set COMPARE_REVIEW=1.'
    );
  };

  return {
    anthropic: {
      messages: {
        create: refuse,
        stream: refuse,
      },
    },
  };
});

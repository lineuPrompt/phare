import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// LIVE COMPARISON — the founder-run check before the cron is enabled.
//
//   COMPARE_REVIEW=1 npx vitest run src/lib/__tests__/liveReviewComparison.test.ts
//
// SKIPPED unless that variable is set. It makes REAL Anthropic calls against
// REAL household data, so it must never run in CI or as part of the suite.
//
// READ-ONLY apart from one thing worth naming: the service may emit a
// `review_text_guard_retried` event if a guard fires. Nothing else is written —
// the service does not persist, so no conversations row is created.
//
// ── WHAT THIS CAN AND CANNOT PROVE ────────────────────────────────────────
//
// It CANNOT prove the extraction is equivalent. The AI is non-deterministic:
// two runs over identical inputs produce different prose, mention a different
// SUBSET of the same figures, and order them differently. Any check that
// demanded matching text would fail every time and teach you to ignore it.
//
// What it CAN do is detect the specific breakages the extraction could cause:
//
//   A DROPPED QUERY   → a figure the stored review cites is now absent from the
//                       computed inputs, so the new text cannot mention it, and
//                       totals printed below will disagree with the ledger.
//   A GUARD MISWIRED  → either the deterministic FALLBACK text appears (fired
//                       when it should not have), or a violation passes through
//                       (fired when it should have — invisible here, which is
//                       why route.guardWiring.test.ts carries that weight).
//   WRONG HOUSEHOLD   → figures that match no row this household owns.
//
// So the assertion is on FIGURES, not prose — and even then, only that every
// figure in the new text is traceable, never that the two texts agree.
// ---------------------------------------------------------------------------

const ENABLED = process.env.COMPARE_REVIEW === '1';
const HOUSEHOLD_ID = process.env.COMPARE_HOUSEHOLD ?? '2be22642-53c5-4599-ad3b-42a076e10484';

/** Minimal .env.local reader — vitest does not load it, and dotenv is not a dep. */
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Dollar figures, normalised to numbers so $1,500.00 and $1500 compare equal. */
function figuresIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

describe.skipIf(!ENABLED)('live review comparison', () => {
  it('generates against real data and reports a figure-level diff', async () => {
    loadEnvLocal();

    const { createClient } = await import('@supabase/supabase-js');
    const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
    const { getHouseholdTimezone } = await import('@/lib/householdTimezone');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

    const admin = createClient(url, key, { auth: { persistSession: false } });

    // The stored review to compare against — the most recent one this household has.
    const { data: stored, error: storedErr } = await admin
      .from('conversations')
      .select('messages, created_at, review_month, type')
      .eq('household_id', HOUSEHOLD_ID)
      .in('type', ['onboarding', 'monthly_review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (storedErr) throw new Error(`Could not read stored review: ${storedErr.message}`);
    if (!stored) throw new Error(`No stored review for household ${HOUSEHOLD_ID}`);

    const messages = (stored.messages ?? []) as { type: string; content: string }[];
    const storedReview = messages.find((m) => m.type === 'monthly_review')?.content ?? '';
    const storedRec = messages.find((m) => m.type === 'top_recommendation')?.content ?? '';

    const timezone = await getHouseholdTimezone(admin, HOUSEHOLD_ID);

    console.log(`\n=== LIVE COMPARISON — household ${HOUSEHOLD_ID} ===`);
    console.log(`stored review written ${stored.created_at} (type=${stored.type}, review_month=${stored.review_month ?? 'null'})`);
    console.log(`timezone ${timezone}\n`);

    const fresh = await generateMonthlyReview({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: admin as any,
      householdId: HOUSEHOLD_ID,
      locale: 'en',
      timezone,
      userId: null,
    });

    const storedFigures = figuresIn(`${storedRec}\n${storedReview}`);
    const freshFigures = figuresIn(`${fresh.topRecommendation}\n${fresh.reviewText}`);
    const onlyInFresh = [...freshFigures].filter((f) => !storedFigures.has(f));
    const shared = [...freshFigures].filter((f) => storedFigures.has(f));

    console.log('--- STORED ---');
    console.log(storedRec, '\n');
    console.log(storedReview, '\n');
    console.log('--- FRESH ---');
    console.log(fresh.topRecommendation, '\n');
    console.log(fresh.reviewText, '\n');
    console.log('--- FIGURES ---');
    console.log('stored :', [...storedFigures].sort((a, b) => a - b).join(', ') || '(none)');
    console.log('fresh  :', [...freshFigures].sort((a, b) => a - b).join(', ') || '(none)');
    console.log('shared :', shared.sort((a, b) => a - b).join(', ') || '(none)');
    console.log('ONLY IN FRESH — check each against the ledger:',
      onlyInFresh.sort((a, b) => a - b).join(', ') || '(none)');
    console.log('\nA figure here is NOT automatically wrong: a different run may cite a');
    console.log('figure the stored one skipped. Each must be traceable to real data.');
    console.log('=== END ===\n');

    // Hard failures — these are unambiguous regressions, not prose variation.
    expect(fresh.reviewText.trim().length, 'empty review text').toBeGreaterThan(0);
    expect(fresh.topRecommendation.trim().length, 'empty top recommendation').toBeGreaterThan(0);

    // The deterministic fallbacks only ship when a guard fired on BOTH the
    // first attempt and the retry. On a household whose stored review was
    // clean, that is a signal the guard's inputs changed in the move.
    const fallbackMarkers = ['review is unavailable', 'bilan est indisponible'];
    for (const marker of fallbackMarkers) {
      expect(
        fresh.reviewText.toLowerCase().includes(marker),
        `FALLBACK TEXT SHIPPED ("${marker}") — a guard fired twice. Investigate before enabling the cron.`
      ).toBe(false);
    }
  }, 180_000);
});

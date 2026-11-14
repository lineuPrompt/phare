// SCRATCH — dry run for handoff 4. Deleted after use. Reads an in-memory copy only.
import { it, vi, expect } from 'vitest';
import fs from 'node:fs';
import { makeFakeCardSupabase } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';

const SP = process.env.SP as string;
const dump = JSON.parse(fs.readFileSync(`${SP}/dump2be.json`, 'utf8'));
const HH = '2be22642-53c5-4599-ad3b-42a076e10484';
const member = dump.household_members.find((m: { user_id: string | null }) => m.user_id);
const seed = { ...dump, users: [{ id: member.user_id, household_id: HH }] };
delete seed.checksum;
const fake = makeFakeCardSupabase(seed, { userId: member.user_id });
const client = {
  auth: fake.client.auth,
  from(table: string) {
    const base = fake.client.from(table);
    return {
      ...base,
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        const chain = base.select(cols);
        if (!opts?.count) return chain;
        const origThen = chain.then.bind(chain);
        (chain as unknown as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          origThen((v: { data: unknown[] | null; error: unknown }) => ({ data: null, error: v.error, count: v.data?.length ?? 0 })).then(res, rej);
        return chain;
      },
    };
  },
};
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => client }));
vi.mock('@/lib/eventLogger', () => ({ logEvent: async () => {} }));

it('plan as the Plan card gets it', async () => {
  const { GET } = await import('@/app/api/timeline/route');
  const chequing = dump.accounts.find((a: { type: string }) => a.type === 'chequing');
  const res = await GET(new Request(`http://x/api/timeline?account=${chequing.id}&includePlan=1`));
  const body = await res.json();
  fs.writeFileSync(`${SP}/plan2be.json`, JSON.stringify({ plan: body.plan, todayBalance: body.todayBalance, isPro: body.isPro, writes: fake.writes }, null, 1));
  expect(body.plan).toBeTruthy();
});

it('proposed letter, real AI, October 2026', async () => {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^ANTHROPIC_API_KEY=(.*)$/.exec(line.trim());
    if (m) process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, '');
  }
  const { GET } = await import('@/app/api/timeline/route');
  const chequing = dump.accounts.find((a: { type: string }) => a.type === 'chequing');
  const body = await (await GET(new Request(`http://x/api/timeline?account=${chequing.id}&includePlan=1`))).json();
  const proto = await import('./zzReviewProto');
  const out = await proto.generateMonthlyReview({
    supabase: client as never, householdId: HH, locale: 'en', timezone: 'America/Toronto',
    reviewMonth: '2026-10', userId: null, plan: body.plan,
  });
  fs.writeFileSync(`${SP}/letter2be.json`, JSON.stringify({ out, log: proto.__protoLog, writes: fake.writes }, null, 1));
  expect(out.reviewText.length).toBeGreaterThan(0);
}, 240000);

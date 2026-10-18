import { describe, it, expect } from 'vitest';
import {
  AppleSyncError,
  handleNotification,
  verifyPurchase,
  type AppleDeps,
  type AppleEnv,
  type StoredHousehold,
} from '../appleSync';
import type { AppleColumns, VerifiedRenewalInfo, VerifiedTransaction } from '../appleSubscriptionMap';

// ---------------------------------------------------------------------------
// A fake Apple: "signed" strings are JSON tagged with the environment that
// signed them, and each environment's verifier accepts only its own — which
// is exactly the library's behaviour (a Sandbox signature fails the
// Production verifier). A fake store records every write.
// ---------------------------------------------------------------------------

const BUNDLE = 'money.phare.app';
const HH = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';
const OTHER_HH = '987c63c1-034b-4607-8623-d6288ce3d78d';
const ORIGINAL = '2000000123';

const sign = (env: AppleEnv, body: object) => JSON.stringify({ env, body });

function unsign<T>(env: AppleEnv, signed: string): T {
  const parsed = JSON.parse(signed) as { env: AppleEnv; body: T };
  if (parsed.env !== env) throw new Error(`signed for ${parsed.env}, not ${env}`);
  return parsed.body;
}

const transaction = (env: AppleEnv, over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
  originalTransactionId: ORIGINAL,
  bundleId: BUNDLE,
  productId: 'phare.app.pro.monthly',
  expiresDate: Date.UTC(2026, 10, 16),
  appAccountToken: HH,
  environment: env,
  signedDate: Date.UTC(2026, 9, 16, 12),
  ...over,
});

type World = {
  households: Record<string, StoredHousehold & { original?: string }>;
  /** What Apple's status API answers, per environment. */
  live: Partial<Record<AppleEnv, { status: number; tx: VerifiedTransaction; renewal?: VerifiedRenewalInfo }>>;
};

function deps(world: World) {
  const writes: { householdId: string; columns: AppleColumns }[] = [];
  const statusCalls: { env: AppleEnv; id: string }[] = [];
  const verifier = (env: AppleEnv) => ({
    verifyAndDecodeTransaction: async (s: string) => unsign<VerifiedTransaction>(env, s),
    verifyAndDecodeRenewalInfo: async (s: string) => unsign<VerifiedRenewalInfo>(env, s),
    verifyAndDecodeNotification: async (s: string) =>
      unsign<{ notificationType?: string; data?: { signedTransactionInfo?: string } }>(env, s),
  });
  const api = (env: AppleEnv) => ({
    getAllSubscriptionStatuses: async (id: string) => {
      statusCalls.push({ env, id });
      const live = world.live[env];
      if (!live) return { data: [] };
      return {
        data: [{
          lastTransactions: [{
            status: live.status,
            originalTransactionId: live.tx.originalTransactionId,
            signedTransactionInfo: sign(env, live.tx),
            signedRenewalInfo: live.renewal ? sign(env, live.renewal) : undefined,
          }],
        }],
      };
    },
  });
  const d: AppleDeps = {
    bundleId: BUNDLE,
    verifiers: { Production: verifier('Production'), Sandbox: verifier('Sandbox') },
    apis: { Production: api('Production'), Sandbox: api('Sandbox') },
    store: {
      // As Postgres does: a uuid column lookup with a non-uuid value is a
      // query ERROR, not "no row".
      findById: async (id) => {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`invalid input syntax for type uuid: "${id}"`);
        return world.households[id] ?? null;
      },
      findByOriginalTransactionId: async (original) =>
        Object.values(world.households).find((h) => h.original === original) ?? null,
      write: async (householdId, columns) => {
        writes.push({ householdId, columns });
      },
    },
  };
  return { d, writes, statusCalls };
}

const freshWorld = (): World => ({
  households: { [HH]: { id: HH, apple_updated_at: null }, [OTHER_HH]: { id: OTHER_HH, apple_updated_at: null } },
  live: { Sandbox: { status: 1, tx: transaction('Sandbox'), renewal: { originalTransactionId: ORIGINAL, autoRenewStatus: 1, signedDate: Date.UTC(2026, 9, 16, 12, 1) } } },
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (err) {
    return err instanceof AppleSyncError ? err.code : `other: ${String((err as Error).message)}`;
  }
}

describe('verifyPurchase', () => {
  it('verifies, asks Apple for the live state in the environment that signed it, and writes it', async () => {
    const { d, writes, statusCalls } = deps(freshWorld());
    const result = await verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox')));
    expect(result.outcome).toBe('applied');
    expect(statusCalls).toEqual([{ env: 'Sandbox', id: ORIGINAL }]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ householdId: HH, columns: { apple_status: 'active', apple_auto_renew: true, apple_environment: 'Sandbox' } });
  });

  it('writes what Apple says NOW, not what the app sent', async () => {
    // The app's copy says active; Apple's live answer says refunded.
    const world = freshWorld();
    world.live.Sandbox = { status: 5, tx: transaction('Sandbox', { signedDate: Date.UTC(2026, 9, 16, 13) }) };
    const { d, writes } = deps(world);
    await verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox')));
    expect(writes[0].columns.apple_status).toBe('revoked');
  });

  it('works for Production as well as the sandbox', async () => {
    const world = freshWorld();
    world.live = { Production: { status: 1, tx: transaction('Production') } };
    const { d, writes, statusCalls } = deps(world);
    await verifyPurchase(d, HH, sign('Production', transaction('Production')));
    expect(statusCalls[0].env).toBe('Production');
    expect(writes[0].columns.apple_environment).toBe('Production');
  });

  it('refuses something no verifier accepts, and writes nothing', async () => {
    const { d, writes } = deps(freshWorld());
    expect(await codeOf(verifyPurchase(d, HH, 'not signed by anyone'))).toBe('invalid_signature');
    expect(writes).toEqual([]);
  });

  it('refuses a purchase made for another household', async () => {
    const { d, writes } = deps(freshWorld());
    expect(await codeOf(verifyPurchase(d, OTHER_HH, sign('Sandbox', transaction('Sandbox'))))).toBe('account_token_mismatch');
    expect(writes).toEqual([]);
  });

  it('refuses a purchase with no household tag at all', async () => {
    const { d } = deps(freshWorld());
    expect(await codeOf(verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox', { appAccountToken: undefined })))))
      .toBe('account_token_mismatch');
  });

  it('accepts the tag whatever its letter case', async () => {
    const { d } = deps(freshWorld());
    const result = await verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox', { appAccountToken: HH.toUpperCase() })));
    expect(result.outcome).toBe('applied');
  });

  it('refuses a subscription already linked to another household — never moves it over', async () => {
    const world = freshWorld();
    world.households[OTHER_HH].original = ORIGINAL;
    const { d, writes } = deps(world);
    expect(await codeOf(verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox'))))).toBe('belongs_to_other_household');
    expect(writes).toEqual([]);
  });

  it('re-linking the same household is fine (a restore)', async () => {
    const world = freshWorld();
    world.households[HH].original = ORIGINAL;
    const { d } = deps(world);
    expect((await verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox')))).outcome).toBe('applied');
  });

  it('does not overwrite a newer stored state with an older one', async () => {
    const world = freshWorld();
    world.households[HH].apple_updated_at = '2026-10-17T00:00:00+00:00';
    const { d, writes } = deps(world);
    expect((await verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox')))).outcome).toBe('stale');
    expect(writes).toEqual([]);
  });

  it('says so when Apple has no such subscription', async () => {
    const world = freshWorld();
    world.live = {};
    const { d, writes } = deps(world);
    expect(await codeOf(verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox'))))).toBe('subscription_not_found');
    expect(writes).toEqual([]);
  });

  it('refuses a household that does not exist', async () => {
    const world = freshWorld();
    delete world.households[HH];
    const { d } = deps(world);
    expect(await codeOf(verifyPurchase(d, HH, sign('Sandbox', transaction('Sandbox'))))).toBe('household_missing');
  });
});

describe('handleNotification', () => {
  const notification = (env: AppleEnv, tx: VerifiedTransaction, type = 'DID_RENEW') =>
    sign(env, { notificationType: type, data: { signedTransactionInfo: sign(env, tx) } });

  it('Apple’s test notification is acknowledged and changes nothing', async () => {
    const { d, writes } = deps(freshWorld());
    expect(await handleNotification(d, sign('Production', { notificationType: 'TEST' }))).toEqual({ outcome: 'test' });
    expect(writes).toEqual([]);
  });

  it('finds the household by the linked subscription and writes the live state', async () => {
    const world = freshWorld();
    world.households[HH].original = ORIGINAL;
    const { d, writes } = deps(world);
    const result = await handleNotification(d, notification('Sandbox', transaction('Sandbox', { appAccountToken: undefined })));
    expect(result).toMatchObject({ outcome: 'applied', householdId: HH });
    expect(writes).toHaveLength(1);
  });

  it('the linked subscription wins over a token naming another household', async () => {
    const world = freshWorld();
    world.households[HH].original = ORIGINAL;
    const { d } = deps(world);
    const result = await handleNotification(d, notification('Sandbox', transaction('Sandbox', { appAccountToken: OTHER_HH })));
    expect(result).toMatchObject({ householdId: HH });
  });

  it('a first notification that beats the app is placed by its token', async () => {
    const { d, writes } = deps(freshWorld());
    const result = await handleNotification(d, notification('Sandbox', transaction('Sandbox', { appAccountToken: HH.toUpperCase() }), 'SUBSCRIBED'));
    expect(result).toMatchObject({ outcome: 'applied', householdId: HH });
    expect(writes[0].householdId).toBe(HH);
  });

  it('a subscription nobody is linked to, with no usable token, is reported, not guessed', async () => {
    const { d, writes } = deps(freshWorld());
    for (const appAccountToken of [undefined, 'not-a-uuid', '11111111-2222-3333-4444-555555555555']) {
      expect(await handleNotification(d, notification('Sandbox', transaction('Sandbox', { appAccountToken }))))
        .toEqual({ outcome: 'household_unknown', originalTransactionId: ORIGINAL });
    }
    expect(writes).toEqual([]);
  });

  it('refuses a notification no verifier accepts', async () => {
    const { d } = deps(freshWorld());
    expect(await codeOf(handleNotification(d, '{"forged":true}'))).toBe('invalid_signature');
  });

  it('a transaction signed in another environment than its notification is refused', async () => {
    const world = freshWorld();
    world.households[HH].original = ORIGINAL;
    const { d } = deps(world);
    const mixed = sign('Production', { notificationType: 'DID_RENEW', data: { signedTransactionInfo: sign('Sandbox', transaction('Sandbox')) } });
    expect(await codeOf(handleNotification(d, mixed))).toMatch(/^other: signed for Sandbox/);
  });

  it('a notification with no transaction is refused by name', async () => {
    const { d } = deps(freshWorld());
    expect(await codeOf(handleNotification(d, sign('Sandbox', { notificationType: 'CONSUMPTION_REQUEST', data: {} }))))
      .toBe('subscription_not_found');
  });
});

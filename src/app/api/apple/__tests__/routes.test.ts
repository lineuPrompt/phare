import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppleSyncError } from '@/lib/apple/appleSync';
import { AppleMappingError } from '@/lib/apple/appleSubscriptionMap';

// ---------------------------------------------------------------------------
// The two Apple routes: their contract with the app and with Apple's retries.
// appleSync's rules are tested in src/lib/apple/__tests__; here the flow is
// replaced so each outcome can be forced and its HTTP answer pinned.
// ---------------------------------------------------------------------------

const verifyPurchase = vi.fn();
const handleNotification = vi.fn();
const appleDeps = vi.fn(() => ({ fake: true }));

vi.mock('@/lib/apple/appleSync', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/apple/appleSync')>();
  return { ...real, verifyPurchase: (...a: unknown[]) => verifyPurchase(...a), handleNotification: (...a: unknown[]) => handleNotification(...a) };
});
vi.mock('@/lib/apple/appleConfig', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/apple/appleConfig')>();
  return { ...real, appleDeps: () => appleDeps() };
});

const getUser = vi.fn();
const userRow = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: () => getUser() },
    from: () => ({ select: () => ({ eq: () => ({ single: () => userRow() }) }) }),
  }),
}));
vi.mock('@/lib/entitlementServer', () => ({
  loadEntitlement: async () => ({ isPro: true, reason: 'apple_active' }),
}));

const post = (body: unknown) =>
  new Request('https://phare.money/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  verifyPurchase.mockReset();
  handleNotification.mockReset();
  appleDeps.mockReset();
  appleDeps.mockImplementation(() => ({ fake: true }));
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  userRow.mockReset();
  userRow.mockResolvedValue({ data: { household_id: 'hh-1' }, error: null });
});

describe('POST /api/apple/verify', () => {
  const route = () => import('../verify/route');

  it('verifies for the caller’s household and answers with the entitlement as it now reads', async () => {
    verifyPurchase.mockResolvedValue({ outcome: 'applied', householdId: 'hh-1', columns: {} });
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'applied', entitlement: { isPro: true, reason: 'apple_active' } });
    expect(verifyPurchase).toHaveBeenCalledWith({ fake: true }, 'hh-1', 'jws');
  });

  it('401 without a session, and Apple is never asked', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(401);
    expect(verifyPurchase).not.toHaveBeenCalled();
  });

  it('400 when the caller has no household', async () => {
    userRow.mockResolvedValue({ data: null, error: { message: 'x' } });
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('no_household');
  });

  it.each([
    ['not JSON', '{nope', 'invalid_body'],
    ['no signedTransaction', { other: 1 }, 'invalid_body'],
    ['a blank one', { signedTransaction: '  ' }, 'invalid_body'],
  ])('400 for %s', async (_label, body, code) => {
    const res = await (await route()).POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
  });

  it('413 for an oversized body — refused, never cut', async () => {
    const res = await (await route()).POST(post({ signedTransaction: 'x'.repeat(40_000) }));
    expect(res.status).toBe(413);
    expect(verifyPurchase).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_signature', 400],
    ['account_token_mismatch', 403],
    ['belongs_to_other_household', 409],
    ['household_missing', 404],
    ['subscription_not_found', 404],
  ] as const)('%s → %i, with its code', async (code, status) => {
    verifyPurchase.mockRejectedValue(new AppleSyncError(code, 'why'));
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it('422 for Apple data that cannot be used, with its code', async () => {
    verifyPurchase.mockRejectedValue(new AppleMappingError('wrong_bundle', 'other app'));
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('wrong_bundle');
  });

  it('503 apple_not_configured until the key is set', async () => {
    const { AppleNotConfiguredError } = await import('@/lib/apple/appleConfig');
    appleDeps.mockImplementation(() => {
      throw new AppleNotConfiguredError(['APPLE_IAP_KEY_ID']);
    });
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('apple_not_configured');
  });

  it('502 with the real reason when Apple or the database fails', async () => {
    verifyPurchase.mockRejectedValue(new Error('Apple API timeout'));
    const res = await (await route()).POST(post({ signedTransaction: 'jws' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Apple API timeout', code: 'apple_verify_failed' });
  });
});

describe('POST /api/apple/notifications', () => {
  const route = () => import('../notifications/route');

  it.each(['applied', 'stale', 'test'])('200 for %s', async (outcome) => {
    handleNotification.mockResolvedValue({ outcome });
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome });
  });

  it('200 for a subscription nobody is linked to — a retry cannot help', async () => {
    handleNotification.mockResolvedValue({ outcome: 'household_unknown', originalTransactionId: '1' });
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(200);
  });

  it('400 for a forged notification', async () => {
    handleNotification.mockRejectedValue(new AppleSyncError('invalid_signature', 'no'));
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(400);
  });

  it('200 not_applied, with the code, for a refusal a person must look at', async () => {
    handleNotification.mockRejectedValue(new AppleSyncError('belongs_to_other_household', 'two households'));
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: 'not_applied', code: 'belongs_to_other_household' });
  });

  it('503 while not configured, so Apple retries until it is', async () => {
    const { AppleNotConfiguredError } = await import('@/lib/apple/appleConfig');
    appleDeps.mockImplementation(() => {
      throw new AppleNotConfiguredError(['APPLE_IAP_PRIVATE_KEY']);
    });
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(503);
  });

  it('500 when Apple or the database fails, so Apple retries', async () => {
    handleNotification.mockRejectedValue(new Error('database down'));
    const res = await (await route()).POST(post({ signedPayload: 'jws' }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('apple_notification_failed');
  });

  it('400 for a body that is not a notification, and 413 for an oversized one', async () => {
    expect((await (await route()).POST(post({ other: 1 }))).status).toBe(400);
    expect((await (await route()).POST(post({ signedPayload: 'x'.repeat(70_000) }))).status).toBe(413);
    expect(handleNotification).not.toHaveBeenCalled();
  });
});

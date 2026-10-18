import { describe, it, expect } from 'vitest';
import { PHARE_PRO_PRODUCT_IDS } from '@phare/core';
import { ApiError } from '../lib/apiErrors';
import {
  handlePurchase,
  isProProduct,
  loadProducts,
  needsCancelWarning,
  proOffer,
  restore,
  subscribe,
  verifyErrorKey,
  type Me,
  type Poster,
  type Store,
  type StorePurchase,
} from '../lib/subscription';

const HH = 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563';
const me = (over: Partial<Me> = {}): Me => ({ isPro: false, entitlementReason: 'none', role: 'owner', household_id: HH, ...over });
const PRO = { isPro: true, reason: 'apple_active' };

/** A fake StoreKit and API, recording every call. */
function world(opts: {
  products?: { id: string; displayPrice: string }[];
  available?: StorePurchase[];
  verify?: (body: unknown) => unknown;
} = {}) {
  const calls: string[] = [];
  const finished: StorePurchase[] = [];
  const store: Store = {
    fetchSubscriptions: async (skus) => {
      calls.push(`fetch ${skus.join(',')}`);
      return opts.products ?? [];
    },
    requestSubscription: async (sku, token) => {
      calls.push(`request ${sku} ${token}`);
    },
    availablePurchases: async () => opts.available ?? [],
    finish: async (p) => {
      calls.push(`finish ${p.productId}`);
      finished.push(p);
    },
  };
  const post = (async (path: string, body: unknown) => {
    calls.push(`post ${path}`);
    return (opts.verify ?? (() => ({ entitlement: PRO })))(body);
  }) as Poster;
  return { store, post, calls, finished };
}

const purchase = (productId = 'phare.app.pro.monthly', purchaseToken: string | null = 'jws-1'): StorePurchase => ({ productId, purchaseToken });

describe('the products', () => {
  it('are exactly the two the server accepts', () => {
    expect([...PHARE_PRO_PRODUCT_IDS]).toEqual(['phare.app.pro.monthly', 'phare.app.pro.yearly']);
    expect(isProProduct('phare.app.pro.yearly')).toBe(true);
    expect(isProProduct('money.phare.app.pro.monthly')).toBe(false);
  });

  it('loads both with StoreKit’s own price string, monthly first, whatever order StoreKit answers in', async () => {
    const w = world({ products: [
      { id: 'phare.app.pro.yearly', displayPrice: '149,00 $' },
      { id: 'phare.app.pro.monthly', displayPrice: '14,99 $' },
    ] });
    expect(await loadProducts(w.store)).toEqual([
      { id: 'phare.app.pro.monthly', displayPrice: '14,99 $', period: 'month' },
      { id: 'phare.app.pro.yearly', displayPrice: '149,00 $', period: 'year' },
    ]);
    expect(w.calls).toEqual(['fetch phare.app.pro.monthly,phare.app.pro.yearly']);
  });

  it('a missing product is an error, never a shorter list', async () => {
    const w = world({ products: [{ id: 'phare.app.pro.monthly', displayPrice: '$14.99' }] });
    await expect(loadProducts(w.store)).rejects.toThrow('did not return phare.app.pro.yearly');
  });

  it('a product without a price is an error, never a blank price', async () => {
    const w = world({ products: [
      { id: 'phare.app.pro.monthly', displayPrice: '' },
      { id: 'phare.app.pro.yearly', displayPrice: '$149.00' },
    ] });
    await expect(loadProducts(w.store)).rejects.toThrow('did not return phare.app.pro.monthly');
  });
});

describe('proOffer — who is offered what', () => {
  it('the owner of a household without Pro may subscribe, for that household', () => {
    expect(proOffer(me())).toEqual({ kind: 'canSubscribe', householdId: HH });
  });

  it('a member may not: only the owner subscribes, as on the web', () => {
    expect(proOffer(me({ role: 'member' }))).toEqual({ kind: 'ownerOnly' });
    expect(proOffer(me({ role: null }))).toEqual({ kind: 'ownerOnly' });
  });

  it('a household already Pro is offered nothing, whoever pays', () => {
    expect(proOffer(me({ isPro: true, entitlementReason: 'comp' }))).toEqual({ kind: 'alreadyPro', reason: 'comp', throughApple: false });
    expect(proOffer(me({ isPro: true, entitlementReason: 'active' }))).toEqual({ kind: 'alreadyPro', reason: 'active', throughApple: false });
    expect(proOffer(me({ isPro: true, entitlementReason: 'apple_ending' }))).toMatchObject({ throughApple: true });
  });

  it('no household id, no purchase', () => {
    expect(proOffer(me({ household_id: null }))).toEqual({ kind: 'ownerOnly' });
  });
});

describe('subscribe', () => {
  it('tags the purchase with the household id', async () => {
    const w = world();
    await subscribe(w.store, proOffer(me()), 'phare.app.pro.yearly');
    expect(w.calls).toEqual([`request phare.app.pro.yearly ${HH}`]);
  });

  it('refuses when nothing may be bought, and asks StoreKit for nothing', async () => {
    const w = world();
    await expect(subscribe(w.store, proOffer(me({ role: 'member' })), 'phare.app.pro.monthly')).rejects.toThrow('nothing to buy');
    expect(w.calls).toEqual([]);
  });
});

describe('handlePurchase — verify first, finish only after', () => {
  it('sends the signed transaction, then finishes, then reports the server’s entitlement', async () => {
    let sent: unknown = null;
    const w = world({ verify: (body) => {
      sent = body;
      return { outcome: 'applied', entitlement: PRO };
    } });
    expect(await handlePurchase(w.store, w.post, purchase())).toEqual({ kind: 'verified', entitlement: PRO });
    expect(sent).toEqual({ signedTransaction: 'jws-1' });
    expect(w.calls).toEqual(['post /api/apple/verify', 'finish phare.app.pro.monthly']);
  });

  it('a refused verify leaves the purchase UNFINISHED, so StoreKit delivers it again', async () => {
    const refusal = new ApiError('server', 503, 'apple_not_configured');
    const w = world({ verify: () => { throw refusal; } });
    expect(await handlePurchase(w.store, w.post, purchase())).toEqual({ kind: 'failed', error: refusal });
    expect(w.finished).toEqual([]);
  });

  it('an answer without an entitlement is a failure, and nothing is finished', async () => {
    const w = world({ verify: () => ({ outcome: 'applied' }) });
    expect((await handlePurchase(w.store, w.post, purchase())).kind).toBe('failed');
    expect(w.finished).toEqual([]);
  });

  it('no signed transaction: nothing sent, nothing finished', async () => {
    const w = world();
    expect((await handlePurchase(w.store, w.post, purchase('phare.app.pro.monthly', null))).kind).toBe('failed');
    expect(w.calls).toEqual([]);
  });

  it('another product is ignored: never sent, never finished', async () => {
    const w = world();
    expect(await handlePurchase(w.store, w.post, purchase('com.other.coins'))).toEqual({ kind: 'ignored' });
    expect(w.calls).toEqual([]);
  });
});

describe('restore', () => {
  it('verifies every Phare Pro purchase StoreKit holds, and only those', async () => {
    const w = world({ available: [purchase('com.other.thing', 'x'), purchase('phare.app.pro.monthly', 'a'), purchase('phare.app.pro.yearly', 'b')] });
    expect(await restore(w.store, w.post)).toEqual({ kind: 'restored', entitlement: PRO });
    expect(w.finished.map((p) => p.productId)).toEqual(['phare.app.pro.monthly', 'phare.app.pro.yearly']);
  });

  it('says plainly when there is nothing to restore', async () => {
    const w = world({ available: [purchase('com.other.thing')] });
    expect(await restore(w.store, w.post)).toEqual({ kind: 'nothingToRestore' });
  });

  it('stops at the first refusal and reports it', async () => {
    const refusal = new ApiError('server', 409, 'belongs_to_other_household');
    const w = world({ available: [purchase()], verify: () => { throw refusal; } });
    expect(await restore(w.store, w.post)).toEqual({ kind: 'failed', error: refusal });
  });

  it('a StoreKit failure is reported, not read as "nothing to restore"', async () => {
    const w = world();
    w.store.availablePurchases = async () => { throw new Error('StoreKit down'); };
    expect((await restore(w.store, w.post)).kind).toBe('failed');
  });
});

describe('needsCancelWarning — before deletion', () => {
  it('only while an Apple subscription is still renewing', () => {
    expect(needsCancelWarning(me({ isPro: true, entitlementReason: 'apple_active' }))).toBe(true);
    expect(needsCancelWarning(me({ isPro: true, entitlementReason: 'apple_grace' }))).toBe(true);
    expect(needsCancelWarning(me({ isPro: true, entitlementReason: 'apple_ending' }))).toBe(false);
    expect(needsCancelWarning(me({ isPro: true, entitlementReason: 'active' }))).toBe(false);
    expect(needsCancelWarning(me())).toBe(false);
  });
});

describe('verifyErrorKey', () => {
  it.each([
    ['account_token_mismatch', 'pro.errors.otherHousehold'],
    ['belongs_to_other_household', 'pro.errors.otherHousehold'],
    ['apple_not_configured', 'pro.errors.notAvailable'],
    ['subscription_not_found', 'pro.errors.notFound'],
    ['invalid_signature', 'pro.errors.notVerified'],
    ['unknown_product', 'pro.errors.notVerified'],
  ])('%s → %s', (code, key) => {
    expect(verifyErrorKey(new ApiError('server', 400, code))).toBe(key);
  });

  it('anything else uses the shared mapping', () => {
    expect(verifyErrorKey(new ApiError('network', null, null))).not.toMatch(/^pro\./);
  });
});

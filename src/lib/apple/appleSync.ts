import {
  appleSubscriptionToColumns,
  isNotOlder,
  type AppleColumns,
  type VerifiedRenewalInfo,
  type VerifiedTransaction,
} from './appleSubscriptionMap';

// ---------------------------------------------------------------------------
// From something Apple signed to the household's apple_* columns.
//
// Two ways in, one way through:
//   verifyPurchase      — the app, right after a purchase or a restore, sends
//                         the signed transaction StoreKit gave it.
//   handleNotification  — Apple's server tells ours that something changed
//                         (renewal, expiry, refund, grace period…).
// Both end in syncHousehold: ask Apple's status API for the subscription's
// LIVE state, verify what it returns, map it, write it. The thing that
// arrived is never trusted to be the latest — the Stripe webhook's
// "re-retrieve, never trust the event body" rule (CLAUDE.md §8).
//
// WHICH HOUSEHOLD. The app sets appAccountToken = the household's id on every
// purchase (piece 3). So:
//   - a purchase is accepted only for the household it was made for;
//   - a notification finds its household by the stored subscription id, or,
//     for a first notification that beats the app's own call, by the token.
// One Apple subscription belongs to one household: a second household
// presenting the same subscription is refused, never moved over.
//
// Everything external is injected (verifiers, status API, store), so every
// rule here is tested without Apple or a database.
// ---------------------------------------------------------------------------

export type AppleEnv = 'Production' | 'Sandbox';
const ENVS: AppleEnv[] = ['Production', 'Sandbox'];

export interface AppleVerifier {
  verifyAndDecodeTransaction(signed: string): Promise<VerifiedTransaction>;
  verifyAndDecodeRenewalInfo(signed: string): Promise<VerifiedRenewalInfo>;
  verifyAndDecodeNotification(signed: string): Promise<{
    notificationType?: string;
    data?: { environment?: string; signedTransactionInfo?: string };
  }>;
}

export interface AppleStatusApi {
  getAllSubscriptionStatuses(transactionId: string): Promise<{
    data?: {
      lastTransactions?: {
        status?: number;
        originalTransactionId?: string;
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
      }[];
    }[];
  }>;
}

export type StoredHousehold = { id: string; apple_updated_at: string | null };

export interface AppleHouseholdStore {
  findById(householdId: string): Promise<StoredHousehold | null>;
  findByOriginalTransactionId(originalTransactionId: string): Promise<StoredHousehold | null>;
  write(householdId: string, columns: AppleColumns): Promise<void>;
}

export type AppleDeps = {
  verifiers: Record<AppleEnv, AppleVerifier>;
  apis: Record<AppleEnv, AppleStatusApi>;
  store: AppleHouseholdStore;
  bundleId: string;
};

export class AppleSyncError extends Error {
  constructor(public readonly code: AppleSyncCode, message: string) {
    super(message);
    this.name = 'AppleSyncError';
  }
}

export type AppleSyncCode =
  | 'invalid_signature'
  | 'account_token_mismatch'
  | 'belongs_to_other_household'
  | 'household_missing'
  | 'subscription_not_found';

export type SyncOutcome = { outcome: 'applied' | 'stale'; householdId: string; columns: AppleColumns };

/**
 * Verify with each environment's verifier in turn. Apple signs Sandbox and
 * Production alike; the library refuses data from the other environment, so
 * the one that accepts it tells us where it came from.
 */
async function firstThatVerifies<T>(attempt: (verifier: AppleVerifier) => Promise<T>, deps: AppleDeps): Promise<{ env: AppleEnv; value: T }> {
  let lastError: unknown = null;
  for (const env of ENVS) {
    try {
      return { env, value: await attempt(deps.verifiers[env]) };
    } catch (err) {
      lastError = err;
    }
  }
  throw new AppleSyncError('invalid_signature', `Apple's signature did not verify: ${String((lastError as Error)?.message ?? lastError)}`);
}

/** The subscription's live state, from Apple, verified and mapped. */
async function liveColumns(deps: AppleDeps, env: AppleEnv, originalTransactionId: string): Promise<AppleColumns> {
  const response = await deps.apis[env].getAllSubscriptionStatuses(originalTransactionId);
  const item = (response.data ?? [])
    .flatMap((group) => group.lastTransactions ?? [])
    .find((candidate) => candidate.originalTransactionId === originalTransactionId);
  if (!item?.signedTransactionInfo) {
    throw new AppleSyncError('subscription_not_found', `Apple has no subscription ${originalTransactionId}`);
  }
  const verifier = deps.verifiers[env];
  const transaction = await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
  const renewal = item.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo) : null;
  return appleSubscriptionToColumns(item.status, transaction, renewal, deps.bundleId);
}

/** Write the live state onto one household, under the one-subscription and ordering rules. */
async function syncHousehold(deps: AppleDeps, householdId: string, env: AppleEnv, originalTransactionId: string): Promise<SyncOutcome> {
  const household = await deps.store.findById(householdId);
  if (!household) throw new AppleSyncError('household_missing', `household ${householdId} does not exist`);

  const holder = await deps.store.findByOriginalTransactionId(originalTransactionId);
  if (holder && holder.id !== householdId) {
    throw new AppleSyncError('belongs_to_other_household', `subscription ${originalTransactionId} belongs to another household`);
  }

  const columns = await liveColumns(deps, env, originalTransactionId);
  if (!isNotOlder(columns.apple_updated_at, household.apple_updated_at)) {
    return { outcome: 'stale', householdId, columns };
  }
  await deps.store.write(householdId, columns);
  return { outcome: 'applied', householdId, columns };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sameId = (a: string | undefined, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

/** The app's call after a purchase or restore: the signed transaction, for the caller's household. */
export async function verifyPurchase(deps: AppleDeps, householdId: string, signedTransaction: string): Promise<SyncOutcome> {
  const { env, value: transaction } = await firstThatVerifies((v) => v.verifyAndDecodeTransaction(signedTransaction), deps);
  if (!sameId(transaction.appAccountToken, householdId)) {
    throw new AppleSyncError('account_token_mismatch', 'this purchase was not made for this household');
  }
  if (!transaction.originalTransactionId) {
    throw new AppleSyncError('subscription_not_found', 'the transaction has no originalTransactionId');
  }
  return syncHousehold(deps, householdId, env, transaction.originalTransactionId);
}

export type NotificationOutcome =
  | SyncOutcome
  /** Apple's "Request a Test Notification": proves the URL works, carries no subscription. */
  | { outcome: 'test' }
  /** Signed by Apple, about a subscription no household is linked to and with no usable token. */
  | { outcome: 'household_unknown'; originalTransactionId: string };

/** Apple's server-to-server notification. */
export async function handleNotification(deps: AppleDeps, signedPayload: string): Promise<NotificationOutcome> {
  const { env, value: notification } = await firstThatVerifies((v) => v.verifyAndDecodeNotification(signedPayload), deps);
  if (notification.notificationType === 'TEST') return { outcome: 'test' };

  const signedTransaction = notification.data?.signedTransactionInfo;
  if (!signedTransaction) {
    throw new AppleSyncError('subscription_not_found', `notification ${String(notification.notificationType)} carries no transaction`);
  }
  const transaction = await deps.verifiers[env].verifyAndDecodeTransaction(signedTransaction);
  const original = transaction.originalTransactionId;
  if (!original) throw new AppleSyncError('subscription_not_found', 'the transaction has no originalTransactionId');

  const linked = await deps.store.findByOriginalTransactionId(original);
  // The token is only ever a household id (a UUID). Anything else cannot name
  // a household, and must not reach a uuid column lookup as a query error.
  const token = transaction.appAccountToken;
  const householdId =
    linked?.id ?? (token && UUID.test(token) ? (await deps.store.findById(token.toLowerCase()))?.id : undefined);
  if (!householdId) return { outcome: 'household_unknown', originalTransactionId: original };

  return syncHousehold(deps, householdId, env, original);
}

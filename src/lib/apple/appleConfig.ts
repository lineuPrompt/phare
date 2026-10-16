import { AppStoreServerAPIClient, Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { createAdminClient } from '@/lib/supabase-admin';
import { appleRootCertificates } from './appleRootCertificates';
import type { AppleDeps, AppleEnv, AppleHouseholdStore, StoredHousehold } from './appleSync';
import type { AppleColumns } from './appleSubscriptionMap';

// ---------------------------------------------------------------------------
// The real dependencies for appleSync.ts, built from the environment.
//
// ENVIRONMENT VARIABLES (server only; set in Vercel and .env.local):
//   APPLE_IAP_KEY_ID        the In-App Purchase key's id (App Store Connect →
//                           Users and Access → Integrations → In-App Purchase)
//   APPLE_IAP_ISSUER_ID     the issuer id shown on that page
//   APPLE_IAP_PRIVATE_KEY   the .p8 file's contents — as-is (multi-line) or
//                           base64 of the whole file
//   APPLE_BUNDLE_ID         money.phare.app
//   APPLE_APP_APPLE_ID      6812001209 (the app's Apple ID; ascAppId)
//
// MISSING CONFIGURATION IS AN ANSWER, NOT A CRASH: appleDeps() throws
// AppleNotConfiguredError, which the routes turn into 503
// `apple_not_configured`. Apple retries a 503 notification, so nothing sent
// before the key is set is lost for good.
//
// enableOnlineChecks = true: certificates are checked for revocation (OCSP)
// and against today's date, as Apple recommends for production.
// ---------------------------------------------------------------------------

export class AppleNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Apple in-app purchase is not configured: missing ${missing.join(', ')}`);
    this.name = 'AppleNotConfiguredError';
  }
}

/** The .p8 key, accepted as PEM text or as base64 of the file. */
export function privateKeyFrom(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed.replace(/\\n/g, '\n');
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
}

const COLUMNS =
  'apple_original_transaction_id, apple_product_id, apple_status, apple_expires_at, ' +
  'apple_grace_period_expires_at, apple_auto_renew, apple_environment, apple_updated_at';

/** households, through the service role. Every read and write checks its error. */
export function supabaseAppleStore(): AppleHouseholdStore {
  const admin = createAdminClient();
  const one = async (column: 'id' | 'apple_original_transaction_id', value: string): Promise<StoredHousehold | null> => {
    const { data, error } = await admin.from('households').select('id, apple_updated_at').eq(column, value).maybeSingle();
    if (error) throw new Error(`households read failed: ${error.message}`);
    return (data as StoredHousehold | null) ?? null;
  };
  return {
    findById: (id) => one('id', id),
    findByOriginalTransactionId: (original) => one('apple_original_transaction_id', original),
    async write(householdId: string, columns: AppleColumns) {
      const { data, error } = await admin.from('households').update(columns).eq('id', householdId).select(COLUMNS);
      if (error) throw new Error(`households write failed: ${error.message}`);
      if (!data || data.length !== 1) throw new Error(`households write touched ${data?.length ?? 0} rows, expected 1`);
    },
  };
}

export function appleDeps(env: Record<string, string | undefined> = process.env): AppleDeps {
  const names = ['APPLE_IAP_KEY_ID', 'APPLE_IAP_ISSUER_ID', 'APPLE_IAP_PRIVATE_KEY', 'APPLE_BUNDLE_ID', 'APPLE_APP_APPLE_ID'] as const;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new AppleNotConfiguredError([...missing]);

  const keyId = env.APPLE_IAP_KEY_ID!.trim();
  const issuerId = env.APPLE_IAP_ISSUER_ID!.trim();
  const privateKey = privateKeyFrom(env.APPLE_IAP_PRIVATE_KEY!);
  const bundleId = env.APPLE_BUNDLE_ID!.trim();
  const appAppleId = Number(env.APPLE_APP_APPLE_ID);
  if (!Number.isInteger(appAppleId)) throw new AppleNotConfiguredError(['APPLE_APP_APPLE_ID (not a number)']);

  const roots = appleRootCertificates();
  const libraryEnv: Record<AppleEnv, Environment> = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX };

  return {
    bundleId,
    store: supabaseAppleStore(),
    verifiers: {
      // The app's Apple ID is required in production and omitted in the sandbox.
      Production: new SignedDataVerifier(roots, true, libraryEnv.Production, bundleId, appAppleId),
      Sandbox: new SignedDataVerifier(roots, true, libraryEnv.Sandbox, bundleId),
    },
    apis: {
      Production: new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, libraryEnv.Production),
      Sandbox: new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, libraryEnv.Sandbox),
    },
  };
}

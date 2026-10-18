/**
 * billing.ts — what Phare Pro is, as numbers and store identifiers, shared by
 * the web server and the Expo app (2026-10-17).
 *
 * Moved here so the app's Phare Pro screen states exactly what the server
 * enforces, and the app requests exactly the products the server accepts:
 *   - HORIZON_MONTHS_FREE / _PRO   ← src/lib/entitlement.ts
 *   - REGENERATIONS_PER_MONTH      ← src/lib/regenerationQuota.ts (the
 *                                    enforced limit)
 *   - PHARE_PRO_PRODUCT_IDS        ← src/lib/apple/appleSubscriptionMap.ts
 * Each web file re-exports from here, so no web import site changed.
 */

/** Months of projection visible on the timeline. */
export const HORIZON_MONTHS_FREE = 3;
export const HORIZON_MONTHS_PRO = 12;

/** Plan regenerations a Pro household may run per calendar month (enforced). */
export const REGENERATIONS_PER_MONTH = 4;

/**
 * The App Store products that grant Phare Pro (App Store Connect, group
 * "Phare Pro", created 2026-10-17; Family Sharing off). The server refuses a
 * transaction for any other product; the app requests only these.
 */
export const PHARE_PRO_PRODUCT_IDS = ['phare.app.pro.monthly', 'phare.app.pro.yearly'] as const;
export type PhareProProductId = (typeof PHARE_PRO_PRODUCT_IDS)[number];

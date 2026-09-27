// Moved to @phare/core (packages/core/src/onboarding.ts), where the mobile
// onboarding flow reads the same rule. Re-exported here so existing web
// imports keep resolving to the one implementation.
export { canGoToDashboard, type PlanSaveStatus } from '@phare/core';

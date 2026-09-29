import type { OnboardingStep } from '@phare/core';

/** The /upload page's screen states. */
export type UploadPageStatus =
  | 'idle' | 'uploading' | 'analyzing' | 'error' | 'plan' | 'form'
  | 'accounts' | 'plausibility_check' | 'member_confirm' | 'anchor_dates';

/**
 * Which /upload screen states are funnel steps (onboarding_step_reached).
 * 'upload_parsed' is not a screen state: the page emits it directly, the
 * moment /api/upload accepts a file, because a parsed file can go straight to
 * member_confirm, plausibility or accounts without resting on a screen of its
 * own. Loading screens, the error screen and the plan are not steps.
 */
export const WEB_STEP_OF: Partial<Record<UploadPageStatus, OnboardingStep>> = {
  member_confirm: 'member_confirm',
  plausibility_check: 'plausibility',
  accounts: 'accounts',
  anchor_dates: 'anchor_dates',
};

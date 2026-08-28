import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canGoToDashboard, type PlanSaveStatus } from '../onboardingCompletion';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

// ---------------------------------------------------------------------------
// The "Go to dashboard" button's visibility rule.
//
// WHAT THIS SUITE CAN AND CANNOT PROVE. This repo runs Vitest in a `node`
// environment: there is no jsdom, no testing-library, and not one component
// render test in src/. So "the button is absent while saving" cannot be
// asserted by rendering PlanDisplay and looking for it.
//
// The rule is therefore tested directly, as a pure function, and a separate
// test reads PlanDisplay's source to prove the component actually gates on
// that function. Neither half is sufficient alone: the first would pass for a
// predicate nobody calls, and the second would pass for a predicate that
// returns the wrong answer.
// ---------------------------------------------------------------------------

const ALL_STATUSES: PlanSaveStatus[] = ['idle', 'saving', 'saved', 'error'];

describe('canGoToDashboard — the button must not appear before the plan is safe', () => {
  it('is hidden while the save is in flight', () => {
    // The one that matters. Nothing in this codebase guards against navigating
    // away mid-save — there is no beforeunload handler anywhere — so a button
    // rendered in this state is a button that can abandon an unsaved plan.
    expect(canGoToDashboard({ planSaveStatus: 'saving', reviewStreaming: false })).toBe(false);
  });

  it('is visible once the save has succeeded', () => {
    expect(canGoToDashboard({ planSaveStatus: 'saved', reviewStreaming: false })).toBe(true);
  });

  it('is hidden while the plan is idle — which is also the replace-dialog state', () => {
    // doSave() resets to 'idle' on a needsConfirmation reply. Nothing has been
    // written at that point and the replace dialog is open.
    expect(canGoToDashboard({ planSaveStatus: 'idle', reviewStreaming: false })).toBe(false);
  });

  it('is hidden after a save error, where a Retry is offered instead', () => {
    expect(canGoToDashboard({ planSaveStatus: 'error', reviewStreaming: false })).toBe(false);
  });

  it('is hidden for every status except saved', () => {
    const visible = ALL_STATUSES.filter((planSaveStatus) =>
      canGoToDashboard({ planSaveStatus, reviewStreaming: false })
    );
    expect(visible).toEqual(['saved']);
  });

  it('is hidden while the review is still streaming, even if a save reads as done', () => {
    // Redundant against today's ordering (streamReview clears the flag in its
    // `finally`, then calls doSave) and asserted anyway: this is what stops a
    // future reordering from rendering the button over a half-written letter.
    expect(canGoToDashboard({ planSaveStatus: 'saved', reviewStreaming: true })).toBe(false);
  });
});

describe('a failed review must not strand the user', () => {
  it('shows the button on a saved plan regardless of the review outcome', () => {
    // streamReview() calls doSave() unconditionally after its
    // try/catch/finally, substituting placeholder copy when the prose failed.
    // So "the letter failed" and "the plan is saved" are independent, and the
    // review-failure case is just planSaveStatus === 'saved' with streaming
    // finished. If this ever goes red, the save flow's guarantee has been
    // broken, not this button.
    expect(canGoToDashboard({ planSaveStatus: 'saved', reviewStreaming: false })).toBe(true);
  });

  it('takes no reviewText argument at all', () => {
    // Structural, and the point of the whole design: coupling visibility to
    // the letter's success is exactly what the save flow was restructured to
    // avoid. A one-argument signature cannot regress into checking it.
    expect(canGoToDashboard.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Wiring — the half a pure test cannot see.
// ---------------------------------------------------------------------------

const PLAN_DISPLAY = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/onboarding/PlanDisplay.tsx'),
  'utf8'
);

describe('PlanDisplay is actually wired to the rule', () => {
  it('imports canGoToDashboard', () => {
    expect(PLAN_DISPLAY).toMatch(/import\s*\{\s*canGoToDashboard\s*\}\s*from\s*'@\/lib\/onboardingCompletion'/);
  });

  it('gates the button on it, passing both pieces of state', () => {
    expect(PLAN_DISPLAY).toMatch(
      /canGoToDashboard\(\{\s*planSaveStatus,\s*reviewStreaming\s*\}\)\s*&&/
    );
  });

  it('renders the label through the goToDashboard key', () => {
    expect(PLAN_DISPLAY).toContain("t('plan.goToDashboard')");
  });

  it('does not gate the button on planSaveStatus inline instead', () => {
    // The failure this catches: someone "simplifies" the call away and writes
    // `planSaveStatus === 'saved' &&` in the JSX, at which point every
    // assertion above still passes while guarding nothing.
    const buttonBlock = PLAN_DISPLAY.slice(PLAN_DISPLAY.indexOf("t('plan.goToDashboard')") - 900);
    expect(buttonBlock).not.toMatch(/planSaveStatus === 'saved'\s*&&/);
  });

  it('reuses the accounts step\'s primary button style rather than a new variant', () => {
    // AccountStep's Confirm button is the onboarding flow's primary action
    // style. Both should render identically; a divergence here means a second
    // variant has been introduced.
    const accountStep = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/onboarding/AccountStep.tsx'),
      'utf8'
    );
    const PRIMARY =
      'className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"';
    expect(accountStep).toContain(PRIMARY);
    expect(PLAN_DISPLAY).toContain(PRIMARY);
  });
});

describe('the label resolves in both locales', () => {
  // i18nKeys.test.ts covers this globally; naming it here means a failure
  // points at this feature rather than at a list of every key in the app.
  it.each([
    ['en', en],
    ['fr', fr],
  ])('%s has upload.plan.goToDashboard', (_locale, catalog) => {
    const value = (catalog as { upload: { plan: Record<string, unknown> } }).upload.plan
      .goToDashboard;
    expect(typeof value).toBe('string');
    expect((value as string).trim()).not.toBe('');
  });

  it('the French label is written natively, not left in English', () => {
    const value = fr.upload.plan.goToDashboard;
    expect(value).not.toBe(en.upload.plan.goToDashboard);
    // "Aller au tableau de bord" — the same phrasing the billing success page
    // already uses (dashboard.successToDashboard), so the product says one
    // thing for one action.
    expect(value).toContain('tableau de bord');
  });

  it('matches the naming the rest of the app already uses for this screen', () => {
    expect(fr.auth.dashboard).toBe('Tableau de bord');
    expect(fr.dashboard.successToDashboard).toContain('tableau de bord');
  });
});

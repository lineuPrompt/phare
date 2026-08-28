import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canGoToDashboard, type PlanSaveStatus } from '../onboardingCompletion';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

// ---------------------------------------------------------------------------
// The "Go to dashboard" button's visibility rule.
//
// READ THIS BEFORE TRUSTING THIS FILE. None of these tests can prove the
// button appears on screen. This repo runs Vitest in a `node` environment with
// no jsdom, no testing-library, and no component render test anywhere in src/.
// An earlier version of this suite passed 17/17 while the button was absent
// from a production screen — asserting that PlanDisplay's SOURCE contains a
// call is not the same as asserting the element renders.
//
// What follows pins the RULE. Whether the rule is wired up and painted is
// checked by rendering the component, not here. Do not read a green run in
// this file as "the button works".
// ---------------------------------------------------------------------------

const ALL_STATUSES: PlanSaveStatus[] = ['idle', 'saving', 'saved', 'error'];

describe('canGoToDashboard — visible unless the screen is asking for something', () => {
  it('is visible on a saved plan', () => {
    expect(canGoToDashboard({ planSaveStatus: 'saved', replaceConfirmationOpen: false })).toBe(true);
  });

  it('is visible while the save is still in flight', () => {
    // Deliberate. The "Saving your plan…" line renders directly beside the
    // button, so the state is visible to the user. The previous rule hid the
    // button here and the result was users stranded on a finished-looking
    // plan screen with no way forward — a certain harm traded against a rare,
    // self-signposted one.
    expect(canGoToDashboard({ planSaveStatus: 'saving', replaceConfirmationOpen: false })).toBe(true);
  });

  it('is visible in the idle state', () => {
    expect(canGoToDashboard({ planSaveStatus: 'idle', replaceConfirmationOpen: false })).toBe(true);
  });

  it('is hidden while a save error and its Retry are on screen', () => {
    // The plan is genuinely not saved and Retry is the action that matters.
    expect(canGoToDashboard({ planSaveStatus: 'error', replaceConfirmationOpen: false })).toBe(false);
  });

  it('is hidden while the replace-confirmation dialog is open', () => {
    // needsConfirmation means nothing has been written and the user is being
    // asked to approve replacing existing data. A competing primary action
    // here would let them leave believing they were done.
    expect(canGoToDashboard({ planSaveStatus: 'idle', replaceConfirmationOpen: true })).toBe(false);
  });

  it('stays hidden for the replace dialog regardless of save status', () => {
    const visible = ALL_STATUSES.filter((planSaveStatus) =>
      canGoToDashboard({ planSaveStatus, replaceConfirmationOpen: true })
    );
    expect(visible).toEqual([]);
  });

  it('is visible for every status except error, when no dialog is open', () => {
    const visible = ALL_STATUSES.filter((planSaveStatus) =>
      canGoToDashboard({ planSaveStatus, replaceConfirmationOpen: false })
    );
    expect(visible).toEqual(['idle', 'saving', 'saved']);
  });
});

describe('the review can never hide the way out', () => {
  it('takes no reviewStreaming or reviewText argument at all', () => {
    // Structural, and the point of the rewrite. The previous rule included
    // `!reviewStreaming`, and a streaming review is not a reason the dashboard
    // should be unreachable. A signature with one object argument whose only
    // keys are the two below cannot regress into consulting the review.
    expect(canGoToDashboard.length).toBe(1);

    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/onboardingCompletion.ts'),
      'utf8'
    );
    const body = source.slice(source.indexOf('export function canGoToDashboard'));
    expect(body).not.toContain('reviewStreaming');
    expect(body).not.toContain('reviewText');
  });
});

// ---------------------------------------------------------------------------
// Wiring. Necessary but NOT sufficient — see the header.
// ---------------------------------------------------------------------------

const PLAN_DISPLAY = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/onboarding/PlanDisplay.tsx'),
  'utf8'
);

describe('PlanDisplay is wired to the rule', () => {
  it('imports canGoToDashboard', () => {
    expect(PLAN_DISPLAY).toMatch(
      /import\s*\{\s*canGoToDashboard\s*\}\s*from\s*'@\/lib\/onboardingCompletion'/
    );
  });

  it('passes the replace-dialog state, derived from replaceConfirmation', () => {
    expect(PLAN_DISPLAY).toMatch(
      /canGoToDashboard\(\{\s*planSaveStatus,\s*replaceConfirmationOpen:\s*replaceConfirmation !== null\s*\}\)/
    );
  });

  it('renders the label through the goToDashboard key', () => {
    expect(PLAN_DISPLAY).toContain("t('plan.goToDashboard')");
  });

  it('reuses the accounts step\'s primary button style rather than a new variant', () => {
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
    expect(value).toContain('tableau de bord');
  });

  it('matches the naming the rest of the app already uses for this screen', () => {
    expect(fr.auth.dashboard).toBe('Tableau de bord');
    expect(fr.dashboard.successToDashboard).toContain('tableau de bord');
  });
});

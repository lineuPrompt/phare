import { describe, it, expect } from 'vitest';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { lookup, type Catalog } from '../i18n/catalog';
import { ApiError } from '../lib/apiErrors';
import {
  canDelete,
  deletionErrorKey,
  deletionOutcome,
  deletionRequest,
  exportPath,
  loadDeletionPreview,
  promoteMember,
  type DeletionPreview,
} from '../lib/accountDeletion';
import type { Getter } from '../lib/timelineLoader';

const SELF: DeletionPreview = {
  verdict: { mode: 'self_delete' },
  householdName: 'The Test Household',
  blastRadius: null,
  confirmWith: { field: 'confirmEmail', phrase: 'me@example.com' },
};
const SOLE: DeletionPreview = {
  verdict: { mode: 'household_delete', reason: 'sole_member' },
  householdName: 'The Test Household',
  blastRadius: { members: 1, accounts: 3, transactions: 1204, recurringItems: 9, sinkingFunds: 2, reviews: 4, monthsOfHistory: 5 },
  confirmWith: { field: 'confirmHouseholdName', phrase: 'The Test Household' },
};
const HATCH: DeletionPreview = { ...SOLE, verdict: { mode: 'household_delete', reason: 'all_pending' } };
const BLOCKED: DeletionPreview = {
  ...SELF,
  verdict: { mode: 'blocked_promote', candidates: [{ id: 'm2', name: 'Sam' }] },
};
const NO_PATH: DeletionPreview = { ...SELF, verdict: { mode: 'blocked_no_path' } };

function getter(body: unknown) {
  return (async () => body) as Getter;
}

describe('loadDeletionPreview — never guess what deletion destroys', () => {
  it('accepts a preview it understands', async () => {
    expect(await loadDeletionPreview(getter(SELF))).toEqual(SELF);
  });

  it.each<[unknown, string]>([
    [{ ...SELF, verdict: { mode: 'archive' } }, 'an unknown verdict'],
    [{ ...SELF, verdict: undefined }, 'no verdict'],
    [{ ...SELF, confirmWith: { field: 'confirmSomething', phrase: 'x' } }, 'an unknown confirmation field'],
    [null, 'no body'],
  ])('refuses %j (%s)', async (body) => {
    await expect(loadDeletionPreview(getter(body))).rejects.toThrow();
  });
});

describe('deletionRequest — which route', () => {
  it('self-deletion goes to /api/me with the email', () => {
    expect(deletionRequest(SELF)).toEqual({ path: '/api/me', field: 'confirmEmail' });
  });

  it('household deletion goes to /api/household with the name', () => {
    expect(deletionRequest(SOLE)).toEqual({ path: '/api/household', field: 'confirmHouseholdName' });
    expect(deletionRequest(HATCH)).toEqual({ path: '/api/household', field: 'confirmHouseholdName' });
  });
});

describe('canDelete — the button gate', () => {
  it('opens on the exact phrase, trimmed and case-insensitive (core’s rule)', () => {
    expect(canDelete(SELF, '  ME@Example.com ', false)).toBe(true);
    expect(canDelete(SOLE, 'the test household', false)).toBe(true);
  });

  it('stays shut on a near miss or a generic word', () => {
    expect(canDelete(SELF, 'me@example.co', false)).toBe(false);
    expect(canDelete(SOLE, 'DELETE', false)).toBe(false);
  });

  it('the escape hatch needs the acknowledgement as well as the phrase', () => {
    expect(canDelete(HATCH, 'The Test Household', false)).toBe(false);
    expect(canDelete(HATCH, 'The Test Household', true)).toBe(true);
  });

  it('a sole member needs no acknowledgement', () => {
    expect(canDelete(SOLE, 'The Test Household', false)).toBe(true);
  });

  it('never opens on a blocked verdict, whatever is typed', () => {
    expect(canDelete(BLOCKED, 'me@example.com', true)).toBe(false);
    expect(canDelete(NO_PATH, 'me@example.com', true)).toBe(false);
  });

  it('never opens when the server sent no phrase', () => {
    expect(canDelete({ ...SELF, confirmWith: { field: 'confirmEmail', phrase: null } }, '', false)).toBe(false);
  });
});

describe('deletionOutcome', () => {
  it('reads 200 as done and 202 as started-but-not-finished', () => {
    expect(deletionOutcome(200)).toBe('deleted');
    expect(deletionOutcome(202)).toBe('partial');
  });
});

describe('deletionErrorKey — the refusal names the message', () => {
  it.each([
    ['confirmation_mismatch', 'deletion.errors.confirmationMismatch'],
    ['promote_first', 'deletion.errors.promoteFirst'],
    ['sole_owner', 'deletion.errors.promoteFirst'],
    ['blocked_no_path', 'deletion.errors.blockedNoPath'],
    ['household_deletion_required', 'deletion.errors.verdictChanged'],
    ['self_delete_instead', 'deletion.errors.verdictChanged'],
    ['last_member', 'deletion.errors.verdictChanged'],
    ['stripe_unavailable', 'deletion.errors.paymentServiceFailed'],
    ['stripe_cancel_failed', 'deletion.errors.paymentServiceFailed'],
  ])('%s → %s', (code, key) => {
    expect(deletionErrorKey(new ApiError('server', 409, code))).toBe(key);
  });

  it('an unknown server failure is the generic deletion failure, not "something on our end"', () => {
    expect(deletionErrorKey(new ApiError('server', 500, null))).toBe('deletion.errors.failed');
    expect(deletionErrorKey(new Error('x'))).toBe('deletion.errors.failed');
  });

  it('a lost session or a lost connection keeps its own message', () => {
    expect(deletionErrorKey(new ApiError('unauthorized', 401, null))).toBe('errors.unauthorized');
    expect(deletionErrorKey(new ApiError('network', null, null))).toBe('errors.network');
  });
});

describe('promoteMember — the one household-management control', () => {
  it('posts to the member’s promote route and nothing else', async () => {
    const sent: string[] = [];
    const post = async <T,>(path: string) => {
      sent.push(path);
      return {} as T;
    };
    expect(await promoteMember(post, 'm2')).toEqual({ ok: true });
    expect(sent).toEqual(['/api/household/members/m2/promote']);
  });

  it('reports a refusal as a message, not a crash', async () => {
    const post = async <T,>(): Promise<T> => {
      throw new ApiError('server', 400, null);
    };
    expect(await promoteMember(post, 'm2')).toEqual({ ok: false, messageKey: 'deletion.promoteFailed' });
  });
});

describe('exportPath', () => {
  it('asks for the export in the app’s language', () => {
    expect(exportPath('fr')).toBe('/api/export/transactions?locale=fr');
  });
});

// Runtime keys the parity test's extractor cannot see.
const RUNTIME_KEYS = [
  'confirmation_mismatch', 'promote_first', 'blocked_no_path', 'household_deletion_required', 'stripe_unavailable',
].map((code) => deletionErrorKey(new ApiError('server', 409, code))).concat([
  deletionErrorKey(new Error('x')),
  'deletion.promoteFailed',
  'deletion.exportFailed',
]);

describe('every runtime deletion key resolves in both locales', () => {
  it.each(['en', 'fr'])('%s', (locale) => {
    const catalog = (locale === 'en' ? en : fr) as Catalog;
    expect(RUNTIME_KEYS.filter((k) => !lookup(catalog, k))).toEqual([]);
    expect(RUNTIME_KEYS).toHaveLength(8);
  });
});

describe('the blocked copy', () => {
  it('no longer points at a "button above" that mobile does not have', () => {
    expect(en.deletion.blockedPromoteBody).not.toMatch(/above/i);
    expect(fr.deletion.blockedPromoteBody).not.toMatch(/ci-dessus/i);
  });
});

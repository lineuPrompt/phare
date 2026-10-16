import { describe, it, expect } from 'vitest';
import { acceptsOpeningBalance, GOAL_ACCOUNT_TYPES } from '@phare/core';
// The web app's own import path. Proves the form and the routes read ONE rule
// (test files are outside the compliance scan that forbids importing web src/).
import {
  acceptsOpeningBalance as acceptsViaWebPath,
  GOAL_ACCOUNT_TYPES as GOAL_TYPES_VIA_WEB_PATH,
} from '../../../../src/lib/dashboardHelpers';
import {
  accountTypeKey,
  addableTypes,
  balanceProblemKey,
  createAccount,
  loadBalanceForm,
  newAccountProblemKey,
  planBalance,
  planNewAccount,
  type Account,
  type Getter,
  type Sender,
} from '../lib/accounts';

const CHEQUING: Account = { id: 'chq', name: 'Chequing', type: 'chequing' };
const VISA: Account = { id: 'v', name: 'Visa', type: 'credit_card' };

/** Records every request; answers from a table; an Error value is thrown. */
function wire(table: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const answer = (path: string) => {
    if (!(path in table)) throw new Error(`unexpected request: ${path}`);
    const value = table[path];
    if (value instanceof Error) throw value;
    return value;
  };
  const get = (async (path: string) => {
    calls.push({ method: 'GET', path });
    return answer(path);
  }) as Getter;
  const post = (async (path: string, body: unknown) => {
    calls.push({ method: 'POST', path, body });
    return answer(`POST ${path}`);
  }) as Sender;
  const patch = (async (path: string, body: unknown) => {
    calls.push({ method: 'PATCH', path, body });
    return answer(`PATCH ${path}`);
  }) as Sender;
  return { get, post, patch, calls };
}

describe('which types take a starting balance', () => {
  it('is the same rule the routes enforce, through both import paths', () => {
    expect(acceptsViaWebPath).toBe(acceptsOpeningBalance);
    expect(GOAL_TYPES_VIA_WEB_PATH).toBe(GOAL_ACCOUNT_TYPES);
  });
});

describe('addableTypes', () => {
  it('offers chequing while the household has none', () => {
    expect(addableTypes([VISA])).toEqual(['chequing', 'credit_card', 'savings', 'tfsa', 'rrsp']);
  });

  it('never offers a second chequing account', () => {
    expect(addableTypes([CHEQUING, VISA])).toEqual(['credit_card', 'savings', 'tfsa', 'rrsp']);
  });
});

describe('planNewAccount', () => {
  it('trims the name and sends only name and type', () => {
    expect(planNewAccount({ name: '  Visa  ', type: 'credit_card', openingBalance: '' })).toEqual({
      ok: true,
      plan: { body: { name: 'Visa', type: 'credit_card' }, openingBalance: null },
    });
  });

  it('refuses a blank name', () => {
    expect(planNewAccount({ name: '   ', type: 'savings', openingBalance: '' })).toEqual({ ok: false, problem: 'nameRequired' });
  });

  it('reads a French-keypad starting balance exactly', () => {
    const planned = planNewAccount({ name: 'Fonds', type: 'savings', openingBalance: '1250,50' });
    expect(planned).toMatchObject({ ok: true, plan: { openingBalance: 1250.5 } });
  });

  it('refuses a starting balance it cannot read exactly, rather than guessing', () => {
    expect(planNewAccount({ name: 'Fund', type: 'tfsa', openingBalance: '1,250.50' })).toEqual({ ok: false, problem: 'balanceInvalid' });
  });

  it('treats a blank or zero starting balance as none', () => {
    expect(planNewAccount({ name: 'Fund', type: 'rrsp', openingBalance: ' ' })).toMatchObject({ ok: true, plan: { openingBalance: null } });
    expect(planNewAccount({ name: 'Fund', type: 'rrsp', openingBalance: '0' })).toMatchObject({ ok: true, plan: { openingBalance: null } });
  });

  it('never sends a starting balance for a type that takes none, even one left in the field', () => {
    // Typed under Savings, then switched to Credit card: the server would
    // refuse it with a 400, and the person never saw the field for a card.
    expect(planNewAccount({ name: 'Visa', type: 'credit_card', openingBalance: '500' })).toMatchObject({
      ok: true, plan: { openingBalance: null },
    });
    expect(planNewAccount({ name: 'Main', type: 'chequing', openingBalance: 'abc' })).toMatchObject({ ok: true });
  });
});

describe('createAccount', () => {
  const created = { account: { id: 'new-1', name: 'Fund', type: 'savings' } };

  it('creates bare, then PATCHes the starting balance — never sends it on the create', async () => {
    const w = wire({ 'POST /api/accounts': created, 'PATCH /api/accounts/new-1': { account: created.account } });
    const outcome = await createAccount(w.post, w.patch, { body: { name: 'Fund', type: 'savings' }, openingBalance: 800 });
    expect(outcome).toEqual({ kind: 'created', account: created.account });
    expect(w.calls).toEqual([
      { method: 'POST', path: '/api/accounts', body: { name: 'Fund', type: 'savings' } },
      { method: 'PATCH', path: '/api/accounts/new-1', body: { openingBalance: 800 } },
    ]);
  });

  it('sends no PATCH when there is no starting balance', async () => {
    const w = wire({ 'POST /api/accounts': created });
    await createAccount(w.post, w.patch, { body: { name: 'Fund', type: 'savings' }, openingBalance: null });
    expect(w.calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('a failed starting balance is reported, with the account it belongs to', async () => {
    const failure = new Error('500');
    const w = wire({ 'POST /api/accounts': created, 'PATCH /api/accounts/new-1': failure });
    const outcome = await createAccount(w.post, w.patch, { body: { name: 'Fund', type: 'savings' }, openingBalance: 800 });
    expect(outcome).toEqual({ kind: 'balanceFailed', account: created.account, error: failure });
  });

  it('a failed create throws, and no balance is attempted', async () => {
    const w = wire({ 'POST /api/accounts': new Error('400') });
    await expect(createAccount(w.post, w.patch, { body: { name: 'Fund', type: 'savings' }, openingBalance: 800 })).rejects.toThrow('400');
    expect(w.calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('an answer without an account is an error, not a success', async () => {
    const w = wire({ 'POST /api/accounts': {} });
    await expect(createAccount(w.post, w.patch, { body: { name: 'Fund', type: 'savings' }, openingBalance: null })).rejects.toThrow('no account');
  });
});

describe('planBalance', () => {
  const TODAY = '2026-10-16';

  it('builds the anchor body for today', () => {
    expect(planBalance({ amount: '2450.75', date: TODAY }, 'chq', TODAY)).toEqual({
      ok: true, body: { accountId: 'chq', anchorDate: TODAY, balance: 2450.75 },
    });
  });

  it('accepts an overdrawn balance and an empty account', () => {
    expect(planBalance({ amount: '-40,25', date: TODAY }, 'chq', TODAY)).toMatchObject({ ok: true, body: { balance: -40.25 } });
    expect(planBalance({ amount: '0', date: TODAY }, 'chq', TODAY)).toMatchObject({ ok: true, body: { balance: 0 } });
  });

  it('refuses a blank or unreadable amount', () => {
    expect(planBalance({ amount: '', date: TODAY }, 'chq', TODAY)).toEqual({ ok: false, problem: 'amountInvalid' });
    expect(planBalance({ amount: '$100', date: TODAY }, 'chq', TODAY)).toEqual({ ok: false, problem: 'amountInvalid' });
  });

  it('refuses a date that is not a real calendar date', () => {
    expect(planBalance({ amount: '10', date: '2026-02-30' }, 'chq', TODAY)).toEqual({ ok: false, problem: 'dateInvalid' });
  });

  it('accepts a past date and refuses tomorrow, by the household’s today', () => {
    expect(planBalance({ amount: '10', date: '2026-10-01' }, 'chq', TODAY)).toMatchObject({ ok: true });
    expect(planBalance({ amount: '10', date: '2026-10-17' }, 'chq', TODAY)).toEqual({ ok: false, problem: 'dateInFuture' });
  });
});

describe('loadBalanceForm', () => {
  const AT = () => new Date('2026-10-17T02:30:00Z'); // still 16 October in Toronto

  it('gives the household’s today and the most recent anchor, whatever the order', async () => {
    const w = wire({
      '/api/accounts': { accounts: [VISA, CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      // Oldest first, as the route sorts them: the latest is the LAST one.
      '/api/anchors?account=chq': { anchors: [
        { anchor_date: '2026-08-12', balance: 1000 },
        { anchor_date: '2026-10-15', balance: '3200.00' },
      ] },
    });
    expect(await loadBalanceForm(w.get, AT)).toEqual({
      chequing: CHEQUING, today: '2026-10-16', latest: { date: '2026-10-15', balance: 3200 },
    });
  });

  it('finds the latest anchor by date even if the order changes', async () => {
    const w = wire({
      '/api/accounts': { accounts: [CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors?account=chq': { anchors: [
        { anchor_date: '2026-10-15', balance: 3200 },
        { anchor_date: '2026-08-12', balance: 1000 },
      ] },
    });
    expect((await loadBalanceForm(w.get, AT)).latest).toEqual({ date: '2026-10-15', balance: 3200 });
  });

  it('an anchors answer with no list is an error, not "no balance set yet"', async () => {
    const w = wire({
      '/api/accounts': { accounts: [CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors?account=chq': {},
    });
    await expect(loadBalanceForm(w.get, AT)).rejects.toThrow('no anchor list');
  });

  it('says there is no balance yet only when the read succeeded with none', async () => {
    const w = wire({
      '/api/accounts': { accounts: [CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors?account=chq': { anchors: [] },
    });
    expect((await loadBalanceForm(w.get, AT)).latest).toBeNull();
  });

  it('a failed anchors read is an error, not "no balance set yet"', async () => {
    const w = wire({
      '/api/accounts': { accounts: [CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors?account=chq': new Error('server'),
    });
    await expect(loadBalanceForm(w.get, AT)).rejects.toThrow('server');
  });

  it('refuses an anchor balance that is not a number, rather than showing $NaN', async () => {
    const w = wire({
      '/api/accounts': { accounts: [CHEQUING] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
      '/api/anchors?account=chq': { anchors: [{ anchor_date: '2026-10-15', balance: 'abc' }] },
    });
    await expect(loadBalanceForm(w.get, AT)).rejects.toThrow('not a number');
  });

  it('with no chequing account, asks for no anchors', async () => {
    const w = wire({
      '/api/accounts': { accounts: [VISA] },
      '/api/household/timezone': { timezone: 'America/Toronto' },
    });
    expect(await loadBalanceForm(w.get, AT)).toEqual({ chequing: null, today: '2026-10-16', latest: null });
    expect(w.calls.some((c) => c.path.startsWith('/api/anchors'))).toBe(false);
  });

  it('an answer with no account list is an error', async () => {
    const w = wire({ '/api/accounts': {}, '/api/household/timezone': { timezone: 'America/Toronto' } });
    await expect(loadBalanceForm(w.get, AT)).rejects.toThrow('no account list');
  });
});

describe('message keys', () => {
  it('maps every type and problem to its own literal key', () => {
    expect(accountTypeKey('credit_card')).toBe('accounts.types.credit_card');
    expect(accountTypeKey('line_of_credit')).toBe('accounts.types.line_of_credit');
    expect(accountTypeKey('something_new')).toBe('accounts.types.other');
    expect(newAccountProblemKey('nameRequired')).toBe('accounts.problems.nameRequired');
    expect(newAccountProblemKey('balanceInvalid')).toBe('accounts.problems.balanceInvalid');
    expect(balanceProblemKey('dateInFuture')).toBe('balance.problems.dateInFuture');
  });
});

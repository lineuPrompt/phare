import { describe, it, expect } from 'vitest';
import { HOME_STATE, isHome, type NavState } from '../lib/homeOnSignOut';

// Signing back in opens on the Overview: on sign-out the root is reset unless
// it already shows the Overview alone. Shapes are the container state logged
// live on the emulator (expo-router 57): a `__root` route wrapping the Stack.

const tabs = (index: number) => ({
  name: '(tabs)',
  state: { index, routes: [{ name: 'index' }, { name: 'timeline' }, { name: 'cards' }, { name: 'more' }] },
});
const container = (routes: NavState['routes']): NavState => ({
  index: 0,
  routes: [{ name: '__root', state: { index: routes.length - 1, routes } }],
});

describe('is the Overview already showing?', () => {
  it('yes: the tabs alone, on the first tab', () => {
    expect(isHome(container([tabs(0)]))).toBe(true);
  });

  it('no: signed out from Account, opened over More', () => {
    expect(isHome(container([tabs(3), { name: 'account' }]))).toBe(false);
  });

  it('no: Account on top even when the tab underneath is the Overview (the live case)', () => {
    expect(isHome(container([tabs(0), { name: 'account' }]))).toBe(false);
  });

  it('no: the tabs alone but on another tab', () => {
    expect(isHome(container([tabs(3)]))).toBe(false);
  });

  it('no: some other screen alone in the Stack', () => {
    expect(isHome(container([{ name: 'account' }]))).toBe(false);
  });

  it('no: a container without the __root wrapper is not the Overview', () => {
    expect(isHome({ index: 0, routes: [tabs(0)] })).toBe(false);
  });

  it('no: the same shape under a wrapper that is not __root', () => {
    expect(isHome({ index: 0, routes: [{ name: '+not-found', state: { index: 0, routes: [tabs(0)] } }] })).toBe(false);
  });

  it('tabs not mounted yet: home unless params name another tab', () => {
    expect(isHome(container([{ name: '(tabs)' }]))).toBe(true);
    expect(isHome(container([{ name: '(tabs)', params: { screen: 'index' } }]))).toBe(true);
    expect(isHome(container([{ name: '(tabs)', params: { screen: 'more' } }]))).toBe(false);
  });

  it('nothing mounted yet counts as home (nothing to reset)', () => {
    expect(isHome(undefined)).toBe(true);
    expect(isHome({ index: 0, routes: [{ name: '__root' }] })).toBe(true);
  });
});

describe('the reset target', () => {
  it('is itself the Overview, so a second sign-out does not reset again', () => {
    expect(isHome(HOME_STATE)).toBe(true);
  });

  it('goes through __root to the tab shell on its first screen', () => {
    expect(HOME_STATE).toEqual({
      index: 0,
      routes: [
        {
          name: '__root',
          state: { index: 0, routes: [{ name: '(tabs)', state: { index: 0, routes: [{ name: 'index' }] } }] },
        },
      ],
    });
  });
});

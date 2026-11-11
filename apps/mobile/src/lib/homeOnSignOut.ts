/**
 * Signing back in always opens on the Overview (Lineu, 2026-11-10).
 *
 * WHY THIS EXISTS. AuthGate renders the sign-in form IN PLACE, on whatever
 * route was showing. Sign out from More → Account and the navigation state
 * behind the form is still "Account on top of the tabs" — so signing back in
 * re-rendered straight into Account. On sign-out the root is reset to the
 * tabs on their first screen, so the next sign-in lands on the Overview.
 *
 * THE __root WRAPPER. expo-router 57's container state is not the app's
 * Stack: it is a stack holding one route, `__root`, whose state is the Stack
 * in app/_layout.tsx (logged live on the emulator, 2026-11-10). A reset that
 * names `(tabs)` at the top level names a route the container doesn't have,
 * and React Navigation silently ignores it — the first version of this did
 * exactly that.
 *
 * Pure, so it is tested without a renderer (see vitest.config.ts).
 */

/** The parts of React Navigation's state this reads. */
export type NavState = {
  index?: number;
  routes: { name: string; params?: object; state?: NavState }[];
};

export const ROOT_ROUTE = '__root';
export const TABS_ROUTE = '(tabs)';
export const HOME_TAB = 'index';

/** The state to reset to: the tab shell alone, on the Overview. */
export const HOME_STATE = {
  index: 0,
  routes: [
    {
      name: ROOT_ROUTE,
      state: {
        index: 0,
        routes: [{ name: TABS_ROUTE, state: { index: 0, routes: [{ name: HOME_TAB }] } }],
      },
    },
  ],
};

/**
 * True when the app already shows the Overview with nothing on top. The
 * reset is skipped then: resetting an identical state still remounts every
 * screen, which would throw away a sign-in or reset form mid-way.
 */
export function isHome(container: NavState | undefined): boolean {
  if (!container) return true;
  const top = container.routes[container.index ?? 0];
  if (container.routes.length !== 1 || top?.name !== ROOT_ROUTE) return false;
  const app = top.state;
  if (!app) return true; // The app's Stack not mounted yet: it opens on its first route.
  if (app.routes.length !== 1 || app.routes[0].name !== TABS_ROUTE) return false;
  const tabs = app.routes[0].state;
  if (!tabs) {
    // Not mounted yet: it opens on a screen named in params, else its first.
    const screen = (app.routes[0].params as { screen?: string } | undefined)?.screen;
    return screen === undefined || screen === HOME_TAB;
  }
  return tabs.routes[tabs.index ?? 0]?.name === HOME_TAB;
}

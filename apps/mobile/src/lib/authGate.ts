import type { SessionState } from './useSession';

/**
 * What a gated route should render for a given session state.
 *
 * SEPARATE FROM THE COMPONENT so it can be tested without a renderer — there
 * is no React Native test renderer in this app (see vitest.config.ts), so a
 * three-way branch inside a component would be verified by reading it.
 *
 * 'loading' IS NOT 'signIn'. Reading the persisted session out of SecureStore
 * is asynchronous, so the first render of every cold start has no session yet.
 * Treating that as signed out flashes the sign-in screen at a signed-in user,
 * and looks identical to the bug where a session fails to persist.
 */
export type GateView = 'loading' | 'signIn' | 'content';

export function gateView(session: SessionState): GateView {
  if (session.status === 'loading') return 'loading';
  return session.status === 'signedIn' ? 'content' : 'signIn';
}

import type { ClientPlatform } from '@phare/core';
import { BEARER } from './callerAccessToken';

/**
 * Which client made this request, for funnel events the SERVER writes (it has
 * no client-stamped field to read). The mobile app is the bearer-token caller;
 * the web app authenticates by session cookie — the same transport test
 * supabase-server.ts uses to choose its client (BEARER, shared).
 */
export function requestPlatform(request: Request): ClientPlatform {
  return BEARER.test(request.headers.get('authorization') ?? '') ? 'mobile' : 'web';
}

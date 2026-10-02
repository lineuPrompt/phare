import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '../route';

// The association file: still served (same appID, JSON, 200), but claiming no
// path — reset and invite links must open in Safari, not in an app with no
// route for them (2026-10-01).
describe('GET /.well-known/apple-app-site-association', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('serves the appID as JSON and claims no path', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'B749Y5BLQZ');
    vi.stubEnv('APPLE_BUNDLE_ID', 'money.phare.app');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.applinks.details).toEqual([{ appIDs: ['B749Y5BLQZ.money.phare.app'], components: [] }]);
    expect(JSON.stringify(body)).not.toContain('/auth/callback');
  });

  it('still refuses to serve a placeholder when unconfigured', async () => {
    vi.stubEnv('APPLE_TEAM_ID', '');
    vi.stubEnv('APPLE_BUNDLE_ID', '');
    expect((await GET()).status).toBe(404);
  });
});

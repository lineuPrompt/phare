import { describe, it, expect, vi, beforeEach } from 'vitest';

// The whole point of this route is that it tells an attacker nothing. These
// tests pin that: the response must be byte-identical for an address with an
// account, an address without one, and an outright Supabase failure. They also
// pin the 60s window, and that the window is keyed on the SUBMITTED address —
// if it were keyed on a found user, the 429 itself would become the oracle.

const resetPasswordMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: { resetPasswordForEmail: (...args: unknown[]) => resetPasswordMock(...args) },
  }),
}));

async function post(body: unknown, url = 'http://localhost/api/auth/forgot-password') {
  const { POST } = await import('../route');
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

// Fresh module = fresh in-memory limiter, so each test starts unthrottled.
async function freshPost(body: unknown, url?: string) {
  vi.resetModules();
  return post(body, url);
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.resetModules();
    resetPasswordMock.mockReset();
    resetPasswordMock.mockResolvedValue({ error: null });
  });

  it('400s on a body with no usable email, without touching the mailer', async () => {
    for (const body of [{}, { email: '' }, { email: 'nope' }, { email: 42 }]) {
      const res = await freshPost(body);
      expect(res.status).toBe(400);
    }
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed JSON body', async () => {
    const res = await freshPost('{not json');
    expect(res.status).toBe(400);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('returns the same 200 { success: true } for a known and an unknown address', async () => {
    const known = await freshPost({ email: 'julia@example.com' });
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ success: true });

    // Supabase reports "user not found" on some versions — must not leak out.
    resetPasswordMock.mockResolvedValue({ error: { message: 'User not found' } });
    const unknown = await freshPost({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ success: true });
  });

  it('still returns the neutral 200 when the mailer throws outright', async () => {
    resetPasswordMock.mockRejectedValue(new Error('SMTP quota exceeded'));
    const res = await freshPost({ email: 'julia@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('normalizes the email before sending, and reuses the existing callback redirect', async () => {
    await freshPost({ email: '  Julia@Example.COM  ', locale: 'en' });
    expect(resetPasswordMock).toHaveBeenCalledWith('julia@example.com', {
      redirectTo: 'http://localhost/auth/callback?next=/en/dashboard',
    });
  });

  it('carries the caller locale into the redirect, defaulting to en for anything unrecognized', async () => {
    await freshPost({ email: 'julia@example.com', locale: 'fr' });
    expect(resetPasswordMock).toHaveBeenLastCalledWith(
      'julia@example.com',
      { redirectTo: 'http://localhost/auth/callback?next=/fr/dashboard' }
    );

    await freshPost({ email: 'julia@example.com', locale: 'es' });
    expect(resetPasswordMock).toHaveBeenLastCalledWith(
      'julia@example.com',
      { redirectTo: 'http://localhost/auth/callback?next=/en/dashboard' }
    );
  });

  it('429s with a wait time on a second request inside the 60s window', async () => {
    const first = await freshPost({ email: 'julia@example.com' });
    expect(first.status).toBe(200);

    const second = await post({ email: 'julia@example.com' });
    expect(second.status).toBe(429);
    const json = await second.json();
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(json.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(resetPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('rate-limits case- and whitespace-variants as the same address', async () => {
    await freshPost({ email: 'julia@example.com' });
    const second = await post({ email: '  JULIA@example.com ' });
    expect(second.status).toBe(429);
    expect(resetPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('rate-limits an address with no account exactly like one with an account', async () => {
    resetPasswordMock.mockResolvedValue({ error: { message: 'User not found' } });
    const first = await freshPost({ email: 'nobody@example.com' });
    expect(first.status).toBe(200);
    const second = await post({ email: 'nobody@example.com' });
    expect(second.status).toBe(429);
  });

  it('limits per address — a different address is not blocked by the first', async () => {
    await freshPost({ email: 'julia@example.com' });
    const other = await post({ email: 'marc@example.com' });
    expect(other.status).toBe(200);
    expect(resetPasswordMock).toHaveBeenCalledTimes(2);
  });

  it('stamps the window even when the send fails, so a retry loop cannot hammer the mailer', async () => {
    resetPasswordMock.mockRejectedValue(new Error('boom'));
    const first = await freshPost({ email: 'julia@example.com' });
    expect(first.status).toBe(200);

    const second = await post({ email: 'julia@example.com' });
    expect(second.status).toBe(429);
    expect(resetPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('allows a resend once the window has elapsed', async () => {
    vi.useFakeTimers();
    try {
      await freshPost({ email: 'julia@example.com' });
      vi.advanceTimersByTime(61_000);
      const again = await post({ email: 'julia@example.com' });
      expect(again.status).toBe(200);
      expect(resetPasswordMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';

// `now` is injectable on the limiter precisely so window behavior can be
// asserted deterministically, without fake timers or sleeps.
const WINDOW = 60_000;

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/plan', { method: 'POST', headers });
}

describe('createRateLimiter', () => {
  it('allows exactly `max` calls inside the window, then refuses', () => {
    const check = createRateLimiter({ windowMs: WINDOW, max: 3 });
    expect(check('a', 0).allowed).toBe(true);
    expect(check('a', 1).allowed).toBe(true);
    expect(check('a', 2).allowed).toBe(true);
    expect(check('a', 3).allowed).toBe(false);
  });

  it('reports a retryAfterSeconds that frees a slot when it elapses', () => {
    const check = createRateLimiter({ windowMs: WINDOW, max: 2 });
    check('a', 0);
    check('a', 0);
    const blocked = check('a', 10_000);
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) throw new Error('unreachable');
    // Oldest hit was at t=0, so the window frees at t=60_000 — 50s away.
    expect(blocked.retryAfterSeconds).toBe(50);
    // Honoring exactly that wait must succeed.
    expect(check('a', 10_000 + blocked.retryAfterSeconds * 1000).allowed).toBe(true);
  });

  it('slides rather than resetting on a fixed boundary', () => {
    const check = createRateLimiter({ windowMs: WINDOW, max: 2 });
    check('a', 0);
    check('a', 59_000);
    // t=59_500: the t=0 hit is still live, so still blocked — a fixed-bucket
    // limiter would have wrongly reset at t=60_000 and allowed a 2x burst.
    expect(check('a', 59_500).allowed).toBe(false);
    // t=60_001: only the t=59_000 hit is live, so one slot is free.
    expect(check('a', 60_001).allowed).toBe(true);
    expect(check('a', 60_002).allowed).toBe(false);
  });

  it('budgets each key independently', () => {
    const check = createRateLimiter({ windowMs: WINDOW, max: 1 });
    expect(check('a', 0).allowed).toBe(true);
    expect(check('a', 0).allowed).toBe(false);
    expect(check('b', 0).allowed).toBe(true);
  });

  it('gives separate limiters separate budgets', () => {
    const one = createRateLimiter({ windowMs: WINDOW, max: 1 });
    const two = createRateLimiter({ windowMs: WINDOW, max: 1 });
    expect(one('a', 0).allowed).toBe(true);
    expect(two('a', 0).allowed).toBe(true);
  });

  it('forgets a key entirely once its window has fully elapsed', () => {
    const check = createRateLimiter({ windowMs: WINDOW, max: 1 });
    check('a', 0);
    expect(check('a', WINDOW).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the originating client from an x-forwarded-for chain', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })))
      .toBe('203.0.113.7');
  });

  it('trims a single-entry x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 203.0.113.7 ' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it("returns 'unknown' when no proxy header is present (local dev)", () => {
    expect(clientIp(req({}))).toBe('unknown');
  });

  it("does not treat an empty x-forwarded-for as a real key", () => {
    expect(clientIp(req({ 'x-forwarded-for': '' }))).toBe('unknown');
  });
});

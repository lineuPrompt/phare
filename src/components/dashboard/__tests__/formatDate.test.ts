import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { formatDate, readableDate } from '../types';

// Run in a Canadian zone, where UTC midnight is the previous evening.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Vancouver'; });
afterAll(() => { process.env.TZ = originalTz; });

describe('formatDate', () => {
  it('prints a bare calendar date as that day, not the day before', () => {
    expect(formatDate('2027-06-30', 'en')).toBe('June 30, 2027');
    expect(formatDate('2027-06-30', 'fr')).toBe('30 juin 2027');
  });

  it('prints a full timestamp on its local day', () => {
    // 06:00 UTC on 1 July is 23:00 on 30 June in Vancouver.
    expect(formatDate('2027-07-01T06:00:00Z', 'en')).toBe('June 30, 2027');
  });

  it('matches readableDate for a bare date', () => {
    expect(formatDate('2026-11-04', 'en')).toBe(readableDate('2026-11-04', 'en'));
  });
});

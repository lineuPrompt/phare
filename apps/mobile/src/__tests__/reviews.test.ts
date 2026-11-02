import { describe, it, expect, vi } from 'vitest';

// The API module reads the app's env at import; this file tests formatting only.
vi.mock('../lib/api', () => ({ apiGet: vi.fn() }));

import { formatWrittenOn } from '../lib/reviews';

// The date beside a month's own refresh on the Reviews screen (2026-11-02),
// formatted as the web's Reviews page does.
describe('formatWrittenOn', () => {
  it('reads as a full date in both locales', () => {
    expect(formatWrittenOn('2026-10-13T15:00:00Z', 'en')).toBe('October 13, 2026');
    expect(formatWrittenOn('2026-10-13T15:00:00Z', 'fr')).toBe('13 octobre 2026');
  });
});

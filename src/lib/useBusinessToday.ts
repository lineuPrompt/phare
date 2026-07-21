'use client';

import { useEffect, useState } from 'react';
import { businessToday, businessMonth } from './dateHelpers';

const DEFAULT_TIMEZONE = 'America/Toronto';

// Module-level cache: every component on a page (and across pages in the
// same session) shares one fetch of the household's timezone rather than
// each form re-requesting it on mount.
let cachedTimezone: string | null = null;
let inflight: Promise<string> | null = null;

function fetchTimezone(): Promise<string> {
  if (cachedTimezone) return Promise.resolve(cachedTimezone);
  if (!inflight) {
    inflight = fetch('/api/household/timezone')
      .then((r) => (r.ok ? r.json() : { timezone: DEFAULT_TIMEZONE }))
      .then((d) => {
        const resolved: string = d.timezone || DEFAULT_TIMEZONE;
        cachedTimezone = resolved;
        return resolved;
      })
      .catch(() => DEFAULT_TIMEZONE);
  }
  return inflight;
}

/**
 * Client-side counterpart to the server's getHouseholdTimezone() +
 * businessToday()/businessMonth() — resolves "today"/"current month" in the
 * household's timezone rather than the browser's guessed local clock, so
 * client and server never disagree about what day it is.
 *
 * Renders once immediately with the default timezone (correct for every
 * household today) and re-renders if the real value differs once fetched —
 * avoids a loading state for what is, in practice, never wrong.
 */
export function useBusinessToday() {
  const [timezone, setTimezone] = useState(cachedTimezone ?? DEFAULT_TIMEZONE);

  useEffect(() => {
    let alive = true;
    fetchTimezone().then((tz) => {
      if (alive) setTimezone(tz);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    timezone,
    today: businessToday(timezone),
    month: businessMonth(timezone),
  };
}

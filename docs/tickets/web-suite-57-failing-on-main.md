# Web suite: 57 tests fail on clean main (found 2026-11-13)

**Found:** while changing the plan's open-statement rule. `git stash` →
`pnpm vitest run` on main (`f48cce5`) → **57 failed / 18 files**, before any
change of this session's.

**Shape:** almost all are event assertions. The recording double for
`eventWriter` (`src/test/eventWriterDouble.ts`, wired in `vitest.setup.ts`)
records nothing, e.g. `eventLogger.test.ts > writes the row through the event
writer`: `expected [] to deeply equal [ { household_id: 'hh-1', … } ]`.
Files include events, regenerate-plan, upload, onboardingQuotaServer,
regenerationQuota, save-plan, card-envelope, dashboard and timeline routes.

**Not yet known:** when it started (last green run), or whether it's the
double, the setup wiring, or a dependency. Diagnose before fixing; the quota
counters count these rows (CLAUDE.md §8), so this matters.

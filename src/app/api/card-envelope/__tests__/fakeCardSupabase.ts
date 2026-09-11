/**
 * In-memory fake Supabase for the Cards-page route tests (2026-09-11).
 *
 * Unlike a scripted-response mock, this one HONOURS the query: eq / in /
 * gte / lte / order / limit really filter the stored rows. That is the whole
 * point for these tests — the $0-trap regression only exists when a route
 * asks for a narrower date range than it renders, and a mock that returns
 * the same rows whatever the filter would hide exactly that bug.
 *
 * Every mutation is appended to `writes`, so a test can assert that a refused
 * request wrote nothing at all.
 *
 * Not a test file (no .test. in the name) — vitest never collects it.
 */

export type Row = Record<string, unknown>;
export type Write = { op: 'upsert' | 'insert' | 'delete' | 'update'; table: string; payload?: unknown; filters?: [string, unknown][] };

type Filter = (r: Row) => boolean;

export function makeFakeCardSupabase(seed: Record<string, Row[]>, opts: { userId?: string; failTables?: string[] } = {}) {
  const store: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((r) => ({ ...r }));
  const writes: Write[] = [];
  const failTables = new Set(opts.failTables ?? []);

  function rowsOf(table: string): Row[] {
    return (store[table] ??= []);
  }

  function selectChain(table: string) {
    const filters: Filter[] = [];
    let orderBy: { field: string; ascending: boolean } | null = null;
    let limitN: number | null = null;

    const run = (): Row[] => {
      let result = rowsOf(table).filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const { field, ascending } = orderBy;
        result = [...result].sort((a, b) => {
          const av = String(a[field]); const bv = String(b[field]);
          return av < bv ? (ascending ? -1 : 1) : av > bv ? (ascending ? 1 : -1) : 0;
        });
      }
      if (limitN !== null) result = result.slice(0, limitN);
      return result.map((r) => ({ ...r }));
    };
    const failure = () => ({ data: null, error: { message: `simulated ${table} failure` } });

    const api = {
      eq(field: string, value: unknown) { filters.push((r) => r[field] === value); return api; },
      in(field: string, values: unknown[]) { filters.push((r) => values.includes(r[field])); return api; },
      gte(field: string, value: string) { filters.push((r) => String(r[field]) >= value); return api; },
      lte(field: string, value: string) { filters.push((r) => String(r[field]) <= value); return api; },
      order(field: string, o?: { ascending?: boolean }) { orderBy = { field, ascending: o?.ascending !== false }; return api; },
      limit(n: number) { limitN = n; return api; },
      single() {
        if (failTables.has(table)) return Promise.resolve(failure());
        const r = run();
        return Promise.resolve(r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'not found' } });
      },
      maybeSingle() {
        if (failTables.has(table)) return Promise.resolve(failure());
        const r = run();
        return Promise.resolve({ data: r[0] ?? null, error: null });
      },
      then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown, reject?: (e: unknown) => unknown) {
        const v = failTables.has(table) ? failure() : { data: run(), error: null };
        return Promise.resolve(v).then(resolve, reject);
      },
    };
    return api;
  }

  function mutationChain(table: string, op: 'delete' | 'update', payload?: Row) {
    const filters: [string, unknown][] = [];
    const api = {
      eq(field: string, value: unknown) { filters.push([field, value]); return api; },
      then(resolve: (v: { data: null; error: null }) => unknown) {
        writes.push({ op, table, payload, filters });
        const match = (r: Row) => filters.every(([f, v]) => r[f] === v);
        if (op === 'delete') store[table] = rowsOf(table).filter((r) => !match(r));
        else rowsOf(table).forEach((r) => { if (match(r)) Object.assign(r, payload); });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: opts.userId ?? 'user-1' } }, error: null }) },
    from(table: string) {
      return {
        select: () => selectChain(table),
        upsert(row: Row, o?: { onConflict?: string }) {
          writes.push({ op: 'upsert', table, payload: row });
          const keys = (o?.onConflict ?? '').split(',').filter(Boolean);
          const existing = keys.length ? rowsOf(table).find((r) => keys.every((k) => r[k] === row[k])) : undefined;
          if (existing) Object.assign(existing, row); else rowsOf(table).push({ ...row });
          return Promise.resolve({ data: null, error: null });
        },
        insert(rows: Row | Row[]) {
          writes.push({ op: 'insert', table, payload: rows });
          for (const r of Array.isArray(rows) ? rows : [rows]) rowsOf(table).push({ ...r });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => mutationChain(table, 'delete'),
        update: (payload: Row) => mutationChain(table, 'update', payload),
      };
    },
  };

  return { client, store, writes };
}

/** households row for a FREE household (no subscription). */
export const FREE_HOUSEHOLD = {
  id: 'hh-1', timezone: 'America/Toronto',
  subscription_status: null, subscription_current_period_end: null, subscription_cancel_at_period_end: false, comp_until: null,
};

/** households row for a PRO household (active, period ends far in the future). */
export const PRO_HOUSEHOLD = {
  ...FREE_HOUSEHOLD,
  subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z',
};

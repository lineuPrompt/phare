import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  buildTransactionsCsv,
  exportFilename,
  exportLabels,
  TRANSACTIONS_EXPORT_SELECT,
  type ExportTx,
} from '@/lib/csvExportHelpers';
import { formatLocalDate } from '@/lib/dateHelpers';

// ---------------------------------------------------------------------------
// GET /api/export/transactions?locale=fr — "export my data", v1.
//
// Household-scoped the same way everything else is: the session client, so
// RLS's `household_id = auth_household_id()` does the scoping. There is no
// household_id filter in the query below on purpose — adding one would imply
// RLS isn't already doing it.
//
// Open to any authenticated member, not owner-gated: every member can already
// see this data in the app, and a member exporting their own household's
// records is the PIPEDA-friendly default. The button currently lives on the
// owner-only household page, so members have no entry point yet — that's a UI
// placement decision, not an API restriction.
//
// ERROR POSTURE: failures return the real reason. This is an authenticated
// caller reading their own household's data, and the failure modes here are
// schema/query faults, not anything that leaks another tenant. A generic
// "please try again" hid a PostgREST embed error through a full build-and-ship
// cycle — the loud version is the one worth having.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const requested = new URL(request.url).searchParams.get('locale');
    const locale = requested === 'fr' ? 'fr' : 'en';

    const { data: rows, error } = await supabase
      .from('transactions')
      .select(TRANSACTIONS_EXPORT_SELECT)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Transactions export — query failed', {
        userId: user.id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        {
          error: `Export failed while reading your transactions: ${error.message}`,
          code: error.code ?? null,
          hint: error.hint ?? null,
        },
        { status: 500 }
      );
    }

    const csv = buildTransactionsCsv((rows ?? []) as ExportTx[], locale, exportLabels(locale));

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(formatLocalDate(new Date()))}"`,
        // A financial export should never sit in a shared or browser cache.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Transactions export GET threw:', err);
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

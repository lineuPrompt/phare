import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import {
  buildTransactionsCsv,
  exportFilename,
  COLUMN_ORDER,
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
      .select('date, amount, type, description, is_bridge, recurring_item_id, source, accounts(name), categories(name, name_fr)')
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Transactions export — query error (userId for ops):', user.id, error);
      return NextResponse.json({ error: 'Could not build the export' }, { status: 500 });
    }

    const t = await getTranslations({ locale, namespace: 'exportData' });

    const csv = buildTransactionsCsv((rows ?? []) as ExportTx[], locale, {
      headers: COLUMN_ORDER.map((column) => t(`columns.${column}`)),
      yes: t('yes'),
      no: t('no'),
      types: {
        expense: t('types.expense'),
        income: t('types.income'),
        transfer: t('types.transfer'),
      },
      sources: {
        manual: t('sources.manual'),
        screenshot: t('sources.screenshot'),
        csv: t('sources.csv'),
        excel: t('sources.excel'),
        bridge: t('sources.bridge'),
      },
    });

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
    return NextResponse.json({ error: 'Could not build the export' }, { status: 500 });
  }
}

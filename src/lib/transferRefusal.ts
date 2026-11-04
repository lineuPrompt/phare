import { formatCurrency, readableDate } from '@/components/dashboard/types';

// ---------------------------------------------------------------------------
// What a refused transfer edit or delete says (2026-11-02).
//
// The savings floor (PATCH/DELETE /api/transfers/[id]) answers
// BALANCE_WOULD_GO_NEGATIVE with the account, the date and the balance it
// would reach; that becomes a sentence in the household's language. Any other
// refusal shows the server's own reason — never a generic "failed" that hides
// it, and never nothing at all (the Goals page used to show nothing).
// ---------------------------------------------------------------------------

type Translate = (key: string, values?: Record<string, string>) => string;

export async function transferRefusal(res: Response, t: Translate, locale: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; code?: string; account?: string; date?: string; balance?: number }
    | null;
  if (
    body?.code === 'BALANCE_WOULD_GO_NEGATIVE' &&
    typeof body.account === 'string' && typeof body.date === 'string' && typeof body.balance === 'number'
  ) {
    return t('wouldGoNegative', {
      account: body.account,
      amount: formatCurrency(body.balance, locale),
      date: readableDate(body.date, locale),
    });
  }
  return body?.error ?? `HTTP ${res.status}`;
}

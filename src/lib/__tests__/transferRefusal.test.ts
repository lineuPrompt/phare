import { describe, it, expect } from 'vitest';
import { transferRefusal } from '../transferRefusal';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

// A refused transfer edit or delete is said, never swallowed (2026-11-02).
// Uses the REAL catalogue strings, so a missing key or a wrong placeholder
// fails here rather than on screen.

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fill = (template: string) => (_key: string, values?: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => values?.[k] ?? `{${k}}`);

const FLOOR = { error: 'raw', code: 'BALANCE_WOULD_GO_NEGATIVE', account: 'Trip', date: '2026-10-10', balance: -300 };

describe('transferRefusal', () => {
  it('the savings floor reads as a sentence, in English', async () => {
    const msg = await transferRefusal(answer(400, FLOOR), fill(en.transferRefusal.wouldGoNegative), 'en');
    expect(msg).toBe("This would take Trip to -$300.00 on October 10, 2026. A savings account can't go below zero.");
  });

  it('and in French, with fr-CA money (U+00A0 before $) and the local date', async () => {
    const msg = await transferRefusal(answer(400, FLOOR), fill(fr.transferRefusal.wouldGoNegative), 'fr');
    expect(msg).toBe("Cela ferait passer Trip à -300,00 $ le 10 octobre 2026. Un compte d'épargne ne peut pas descendre sous zéro.");
  });

  it('any other refusal shows the server’s own reason', async () => {
    const msg = await transferRefusal(answer(409, { error: 'Transfer no longer exists' }), fill('unused'), 'en');
    expect(msg).toBe('Transfer no longer exists');
  });

  it('a refusal without a body still says something, with the status', async () => {
    const msg = await transferRefusal(new Response('oops', { status: 502 }), fill('unused'), 'en');
    expect(msg).toBe('HTTP 502');
  });
});

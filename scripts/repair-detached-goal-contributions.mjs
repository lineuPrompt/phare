/**
 * ONE-TIME REPAIR — detached future contributions on ONE goal.
 * Household 2be22642 ("Ferias e Viagens"), 2026-08-31.
 *
 * WHAT WENT WRONG. The goal card had no way to edit its contribution rule,
 * so the household raised $25/2wk to $125/2wk by editing each upcoming
 * materialized row by hand. Every one of those edits ran detach-on-edit
 * (PATCH /api/transfers/[id]): it wrote a tombstone on the row's date and
 * nulled recurring_item_id on BOTH sides of the transfer pair. The rows now
 * say $125, the rule still says $25, and no join survives to connect them.
 *
 * WHY A REPAIR IS NEEDED BEFORE THE NEW EDITOR HELPS. splitRule deletes the
 * old rule's rows from the effective boundary forward by recurring_item_id.
 * Against 24 detached rows that DELETE matches nothing, and the carried
 * tombstones then suppress the new rule from re-materializing those dates.
 * Editing the rule would be a no-op: the $125 rows would survive untouched
 * and the new rule would materialize only the four dates past the last
 * tombstone. Re-attaching first is what makes the normal path work.
 *
 * WHAT THIS SCRIPT DOES — and deliberately does not do.
 *   1. Re-attaches the detached FUTURE rows (both sides of each pair) to the
 *      rule that originally made them.
 *   2. Deletes the tombstones for those same dates.
 * That is all. It does NOT change any amount, does not create or freeze a
 * rule, and does not touch a single row dated on or before today. The actual
 * $25 → $125 change is then made through the shipped contribution editor,
 * which takes the normal split path — so the repair reuses the real
 * machinery instead of reimplementing it here, and the result is one honest
 * history: $25 through Aug 26, $125 from Sep 9 forward, with the old rule
 * frozen and linked by predecessor_id.
 *
 * Dry run by default. Pass --commit to write.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const HOUSEHOLD_ID = '2be22642-53c5-4599-ad3b-42a076e10484';
const GOAL_NAME = 'Ferias e Viagens';

const COMMIT = process.argv.includes('--commit');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const money = (n) => (n < 0 ? '-' : ' ') + '$' + Math.abs(Number(n)).toFixed(2).padStart(8);

// The household's own business day — the same cutoff the app uses to decide
// what is history. Everything at or before it is untouchable here.
const { data: hh } = await sb.from('households').select('timezone').eq('id', HOUSEHOLD_ID).single();
const tz = hh?.timezone ?? 'America/Toronto';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const { data: account } = await sb
  .from('accounts').select('id, name')
  .eq('household_id', HOUSEHOLD_ID).eq('name', GOAL_NAME).single();
if (!account) { console.error('Goal account not found — aborting.'); process.exit(1); }

const { data: rule } = await sb
  .from('recurring_items').select('id, amount, cadence, anchor_date, active')
  .eq('household_id', HOUSEHOLD_ID).eq('type', 'transfer').eq('active', true)
  .eq('destination_account_id', account.id).single();
if (!rule) { console.error('No active contribution rule on that goal — aborting.'); process.exit(1); }

console.log('household :', HOUSEHOLD_ID);
console.log('goal      :', account.name, `(${account.id})`);
console.log('rule      :', rule.id, `— $${Number(rule.amount).toFixed(2)} ${rule.cadence}, anchor ${rule.anchor_date}`);
console.log('today (' + tz + '):', today);
console.log('mode      :', COMMIT ? '*** COMMIT ***' : 'DRY RUN (pass --commit to write)');

// Every transfer row on the goal side, so the before/after list shows the
// untouched history alongside the rows being repaired.
const { data: goalRows } = await sb
  .from('transactions')
  .select('id, date, amount, description, recurring_item_id, transfer_peer_id')
  .eq('household_id', HOUSEHOLD_ID).eq('account_id', account.id).eq('type', 'transfer')
  .order('date', { ascending: true });

const past = (goalRows ?? []).filter((r) => r.date <= today);
const future = (goalRows ?? []).filter((r) => r.date > today);
const toReattach = future.filter((r) => r.recurring_item_id === null);

// Both sides of each pair carry recurring_item_id; repair both or the next
// split's DELETE would only find half of each transfer.
const peerIds = [];
for (const r of toReattach) {
  if (r.transfer_peer_id) peerIds.push(r.transfer_peer_id);
}
const { data: reversePeers } = await sb
  .from('transactions').select('id, date, amount, account_id, recurring_item_id')
  .eq('household_id', HOUSEHOLD_ID)
  .in('transfer_peer_id', toReattach.map((r) => r.id));
const peerIdSet = new Set([...peerIds, ...(reversePeers ?? []).map((p) => p.id)]);

const { data: tombstones } = await sb
  .from('recurring_skipped_dates').select('date')
  .eq('household_id', HOUSEHOLD_ID).eq('recurring_item_id', rule.id)
  .gt('date', today)
  .order('date', { ascending: true });

console.log('\n=== BEFORE ===');
console.log('-- past rows (dated <= today) — NEVER TOUCHED --');
for (const r of past) {
  console.log(`   ${r.date}  ${money(r.amount)}  rule=${r.recurring_item_id ? r.recurring_item_id.slice(0, 8) : 'NULL'}  "${r.description}"`);
}
console.log('-- future rows (dated > today) --');
for (const r of future) {
  const mark = r.recurring_item_id === null ? 'DETACHED -> re-attach' : 'attached, leave alone';
  console.log(`   ${r.date}  ${money(r.amount)}  rule=${r.recurring_item_id ? r.recurring_item_id.slice(0, 8) : 'NULL'}  ${mark}`);
}
console.log(`-- tombstones on rule ${rule.id.slice(0, 8)} dated > today --`);
console.log('  ', (tombstones ?? []).map((t) => t.date).join(', ') || '(none)');

console.log('\n=== PLANNED CHANGES ===');
console.log(`  re-attach recurring_item_id = ${rule.id}`);
console.log(`    on ${toReattach.length} goal-side rows + ${peerIdSet.size} chequing-side peers = ${toReattach.length + peerIdSet.size} rows total`);
console.log(`  delete ${(tombstones ?? []).length} tombstones dated > ${today}`);
console.log('  amounts changed: 0        rows deleted: 0        rows created: 0');
console.log(`  rows dated <= ${today} touched: 0`);

console.log('\n=== AFTER (projected) ===');
for (const r of past) console.log(`   ${r.date}  ${money(r.amount)}  rule=${r.recurring_item_id ? r.recurring_item_id.slice(0, 8) : 'NULL'}  (unchanged)`);
for (const r of future) console.log(`   ${r.date}  ${money(r.amount)}  rule=${rule.id.slice(0, 8)}  (re-attached, amount unchanged)`);
console.log('   tombstones > today: (none)');

console.log('\nAfter this runs, the goal card shows the drift notice ($125 rows under a');
console.log('$25 rule) and the contribution editor is armed. Setting the rule to $125');
console.log('there takes the normal split path with effectiveFrom = first of next month,');
console.log('which replaces every row above from Sep 9 forward and leaves Aug 12 / Aug 26');
console.log('exactly as they are.');

if (!COMMIT) {
  console.log('\nDRY RUN — nothing was written. Re-run with --commit to apply.');
  process.exit(0);
}

const idsToAttach = [...toReattach.map((r) => r.id), ...peerIdSet];
const { error: attachErr, count: attached } = await sb
  .from('transactions')
  .update({ recurring_item_id: rule.id }, { count: 'exact' })
  .in('id', idsToAttach)
  .eq('household_id', HOUSEHOLD_ID)
  .gt('date', today);            // belt-and-braces: never let this reach history
if (attachErr) { console.error('re-attach failed:', attachErr); process.exit(1); }

const { error: tombErr, count: removed } = await sb
  .from('recurring_skipped_dates')
  .delete({ count: 'exact' })
  .eq('household_id', HOUSEHOLD_ID)
  .eq('recurring_item_id', rule.id)
  .gt('date', today);
if (tombErr) { console.error('tombstone delete failed:', tombErr); process.exit(1); }

console.log(`\nCOMMITTED — ${attached} rows re-attached, ${removed} tombstones deleted.`);

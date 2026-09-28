import { businessMonth, DEFAULT_HOUSEHOLD_TIMEZONE, formatCADLocale } from '@phare/core';
import type { Locale } from '../i18n/catalog';
import type { Getter } from './timelineLoader';
import type { TimezoneResponse } from './timeline';

// ---------------------------------------------------------------------------
// The card room: which credit card has room left this month.
//
// EVERY FIGURE IS THE SERVER'S. /api/cards/overview computes goal, spent,
// remaining and status per card, scoped to each card's own statement cycle —
// the same shared envelope math every card surface on the web uses. Nothing
// here adds, subtracts or classifies. The client's only decision is which
// month "this month" is, and that comes from businessMonth() in the
// household's own timezone, exactly as the timeline does.
//
// TIMEZONE FAILURE PROPAGATES, for the reason timelineLoader.ts gives: a
// guessed zone near midnight on the 1st asks for the wrong month's cards and
// shows it as this month's.
// ---------------------------------------------------------------------------

/** Mirrors EnvelopeStatus in the web app's envelopeHelpers.ts. */
export type CardStatus = 'ok' | 'watch' | 'over' | 'unset';

/** One row of GET /api/cards/overview, as the route returns it. */
export type CardRow = {
  id: string;
  name: string;
  /** null: no goal set for this card this month. NOT zero. */
  goal: number | null;
  spent: number;
  /** null whenever goal is null. NOT zero. */
  remaining: number | null;
  status: CardStatus;
};

export type CardsOverviewResponse = { month: string; cards: CardRow[] } | { cards: [] };

export type CardsLoad =
  | { kind: 'ready'; month: string; cards: CardRow[] }
  /** No credit card on the household. Cards are added on the web. */
  | { kind: 'noCards'; month: string };

export function cardsOverviewPath(month: string): string {
  return `/api/cards/overview?month=${encodeURIComponent(month)}`;
}

export async function loadCards(get: Getter, at: () => Date = () => new Date()): Promise<CardsLoad> {
  const timezone = await get<TimezoneResponse>('/api/household/timezone');
  const month = businessMonth(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());

  const data = await get<CardsOverviewResponse>(cardsOverviewPath(month));
  if (data.cards.length === 0) return { kind: 'noCards', month };

  // The route echoes the month it computed. A mismatch means the figures are
  // for some other month than the heading would claim — refuse rather than
  // label them wrongly.
  if ('month' in data && data.month !== month) {
    throw new Error(`cards overview answered for ${data.month}, asked for ${month}`);
  }

  return { kind: 'ready', month, cards: data.cards };
}

/**
 * A card figure for display: the amount, or an em dash when there is none.
 *
 * A missing goal is not a $0 goal, and "room: $0" would tell a household it
 * has nothing left to spend on a card that simply has no plan.
 */
export function cardFigure(value: number | null, locale: Locale): string {
  return value === null ? '—' : formatCADLocale(value, locale);
}

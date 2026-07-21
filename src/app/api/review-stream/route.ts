import { NextRequest } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  const { analysis, plan, locale } = await request.json();

  const lang = locale === 'fr' ? 'French' : 'English';

  // The plan's structured sections (sinking funds, goals) are user-derived or
  // empty — never AI-invented (see api/plan/route.ts). For the manual-form
  // (calculated) source the family has entered only income and expenses, so
  // the review must not narrate goals or sinking funds as things they already
  // have or contribute to. It MAY suggest one — framed as a suggestion.
  const isManual = analysis?.source === 'calculated';

  const prompt = `You are Phare, an AI financial coach for Canadian families. Write this family's first monthly review in ${lang}.

Their plan:
${JSON.stringify(plan)}

Key context:
${JSON.stringify(analysis?.insights || [])}

Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. It must feel like a letter from a trusted financial advisor, not a report.
${isManual ? '\nThis family entered ONLY their income and expenses. They have NOT set any savings goals or sinking funds. Do NOT state or imply they have any, and do NOT total up contributions to funds/goals that do not exist. You MAY suggest one or two to consider (e.g. a property-tax fund for Quebec\'s March/June bills), but phrase them explicitly as suggestions ("you might consider…"), never as amounts they already set aside.\n' : ''}
Good tone: "June was a solid month overall. You stayed within budget in four of five categories..."
Bad tone: "Based on a comprehensive analysis of your financial data..."

Hard rules:
- SINKING FUNDS: each entry in "sinkingFunds" (if any) carries a "fundedAlready" boolean. When fundedAlready is false — the case at this stage, since no account or transfer exists yet — describe it as a plan or recommendation only: "your plan sets aside $X/month for {name}" or "recommended: $X/month toward {name} so the {month} bill doesn't catch you off guard." NEVER say "you're setting aside $X/month" or "you're saving $X/month" for that fund unless fundedAlready is true.
- ZERO-BALANCE GOALS: for any goal whose "savedSoFar" is 0 and "fundedAlready" is false, write about it as forward-looking — e.g. "once your $X/month contribution begins" — never as if saving is already underway, even if "onTrack" is true (onTrack only means the required contribution fits their capacity, not that any money has moved yet).

Start with what is going well, then what to watch, then the one thing to do this month. Write ONLY the review text, no preamble, no headings.`;

  const stream = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error('Stream error:', err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
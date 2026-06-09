import { NextRequest } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  const { analysis, plan, locale } = await request.json();

  const lang = locale === 'fr' ? 'French' : 'English';

  const prompt = `You are Phare, an AI financial coach for Canadian families. Write this family's first monthly review in ${lang}.

Their plan:
${JSON.stringify(plan)}

Key context:
${JSON.stringify(analysis?.insights || [])}

Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. It must feel like a letter from a trusted financial advisor, not a report.

Good tone: "June was a solid month overall. You stayed within budget in four of five categories..."
Bad tone: "Based on a comprehensive analysis of your financial data..."

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
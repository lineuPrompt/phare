import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import {
  REVIEW_MAX_BODY_BYTES,
  assertBodySize,
  projectPlanForReviewPrompt,
  isPromptInputTooLargeError,
} from '@/lib/promptInputLimits';

// Same posture as /api/plan: unauthenticated because this route reads nothing
// from the database — the letter is written from the plan in the request body
// — and so has no tenant to scope to. NOT because no household exists: the
// signup trigger creates one and onboarding runs after signup.
//
// It does spend Anthropic tokens (streamed, 1500 max_tokens).
// The client fires this exactly 1:1 with /api/plan, immediately after it
// succeeds, and never retries it on its own — a failed stream falls back to
// placeholder copy and proceeds to save. So the budget matches /api/plan's.
const rateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 8 });

// Every non-success path returns JSON even though the success path streams
// text/plain. That is safe because the caller checks res.ok before reading the
// body, so it never parses this as prose — and it is now load-bearing rather
// than incidental: the client reads `code` off this body to tell a payload
// rejection (permanent, worth naming) from a transient outage (retry copy).
function errorResponse(
  body: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>
) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(request: NextRequest) {
  // M4 FIX: everything that can throw now sits inside this try. `await
  // request.json()` used to run outside it, so a malformed body was an
  // unhandled rejection rather than a 400 the client could read.
  try {
    const limit = rateLimit(clientIp(request));
    if (!limit.allowed) {
      return errorResponse(
        {
          code: 'RATE_LIMITED',
          error: 'Too many review requests. Please wait a moment and try again.',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        429,
        { 'Retry-After': String(limit.retryAfterSeconds) }
      );
    }

    // SIZE BEFORE PARSE — same doctrine as /api/plan. The cap is larger here
    // because this body legitimately carries the assembled plan; see
    // lib/promptInputLimits.ts for the derivation.
    const raw = await request.text();
    try {
      assertBodySize(raw, REVIEW_MAX_BODY_BYTES, 'body');
    } catch (err) {
      if (isPromptInputTooLargeError(err)) {
        return errorResponse(
          { code: err.code, error: err.message, field: err.field, limit: err.limit, actual: err.actual },
          413
        );
      }
      throw err;
    }

    let parsedBody: { analysis?: { source?: string }; plan?: unknown; locale?: string };
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return errorResponse(
        { code: 'INVALID_JSON', error: 'Request body was not valid JSON.' },
        400
      );
    }

    const { analysis, plan: rawPlan, locale } = parsedBody;
    const lang = locale === 'fr' ? 'French' : 'English';

    // ALLOWLIST PROJECTION. Only the fields /api/plan actually produces reach
    // the prompt; anything else a caller attaches to `plan` is dropped before
    // serialisation, and any oversized field is refused outright.
    //
    // `analysis` is NOT projected into the prompt at all — it never was, in
    // substance. The client used to send the entire /api/plan request body
    // here and this route read exactly one field from it (`source`), so the
    // client now sends `{ source }` alone. The server still reads only that
    // one field regardless of what arrives, because the client is untrusted:
    // the smaller payload is a bandwidth fix, not a security control. The
    // body cap above is the control.
    let plan;
    try {
      plan = projectPlanForReviewPrompt(rawPlan);
    } catch (err) {
      if (isPromptInputTooLargeError(err)) {
        return errorResponse(
          { code: err.code, error: err.message, field: err.field, limit: err.limit, actual: err.actual },
          413
        );
      }
      throw err;
    }

    // The plan's structured sections (sinking funds, goals) are user-derived or
    // empty — never AI-invented (see api/plan/route.ts). For the manual-form
    // (calculated) source the family has entered only income and expenses, so
    // the review must not narrate goals or sinking funds as things they already
    // have or contribute to. It MAY suggest one — framed as a suggestion.
    const isManual = analysis?.source === 'calculated';

    // The "Key context" block that used to sit under the plan is gone. It
    // interpolated `analysis?.insights`, a field that has never existed
    // anywhere in this repo, so it always rendered the literal `[]` — two
    // lines of prompt spent telling the model nothing.
    const prompt = `You are Phare, a financial planning system for Canadian households. Write this household's first monthly review in ${lang}.

Their plan:
${JSON.stringify(plan)}

Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. It must feel like a letter from a trusted financial advisor, not a report.
${isManual ? '\nThis household entered ONLY their income and expenses. They have NOT set any savings goals or reserve funds. Do NOT state or imply they have any, and do NOT total up contributions to funds/goals that do not exist. You MAY suggest one or two to consider (e.g. a property-tax fund for Quebec\'s March/June bills), but phrase them explicitly as suggestions ("you might consider…"), never as amounts they already set aside.\n' : ''}
Good tone: "June was a solid month overall. You stayed within budget in four of five categories..."
Bad tone: "Based on a comprehensive analysis of your financial data..."

Hard rules:
- SINKING FUNDS: each entry in "sinkingFunds" (if any) carries a "fundedAlready" boolean. When fundedAlready is false — the case at this stage, since no account or transfer exists yet — describe it as a plan or recommendation only: "your plan sets aside $X/month for {name}" or "recommended: $X/month toward {name} so the {month} bill doesn't catch you off guard." NEVER say "you're setting aside $X/month" or "you're saving $X/month" for that fund unless fundedAlready is true.
- ZERO-BALANCE GOALS: for any goal whose "savedSoFar" is 0 and "fundedAlready" is false, write about it as forward-looking — e.g. "once your $X/month contribution begins" — never as if saving is already underway, even if "onTrack" is true (onTrack only means the required contribution fits their capacity, not that any money has moved yet).

Start with what is going well, then what to watch, then the one thing to do this month. Write ONLY the review text, no preamble, no headings.`;

    // Upstream failure is its own outcome — with a spend cap on the Anthropic
    // key, a quota refusal is reachable and must not surface as a bare English
    // string. This is checked BEFORE the stream opens, so the client still
    // sees a JSON body with a code rather than a half-written letter.
    let stream;
    try {
      stream = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      });
    } catch (aiError) {
      console.error('Review stream — Anthropic call failed:', aiError);
      return errorResponse(
        { code: 'AI_UNAVAILABLE', error: 'The review service is unavailable right now. Please try again in a few minutes.' },
        503
      );
    }

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
  } catch (error) {
    console.error('Review stream error:', error);
    return errorResponse(
      { code: 'REVIEW_FAILED', error: 'Failed to generate the review.' },
      500
    );
  }
}

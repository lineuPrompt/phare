import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    let prompt: string;

    if (body.source === 'template') {
      // Template path: numbers are already verified by code. Claude ONLY interprets.
      const p = body.parsed;
      prompt = `You are Phare, an AI financial coach for Canadian families. The family filled out the official Phare template, so all numbers below are VERIFIED and EXACT. Do NOT change, recalculate, or invent any numbers — use these exactly as given.

VERIFIED DATA:
Household: ${JSON.stringify(p.household)}
Monthly income: $${p.summary.monthlyIncome} (lines: ${JSON.stringify(p.income.lines)})
Fixed expenses: $${p.fixedExpenses.total} (lines: ${JSON.stringify(p.fixedExpenses.lines)})
Variable expenses: $${p.variableExpenses.total} (lines: ${JSON.stringify(p.variableExpenses.lines)})
Monthly expenses total: $${p.summary.monthlyExpenses}
Net cash flow: $${p.summary.netCashFlow}
Sinking funds: ${JSON.stringify(p.sinkingFunds.lines)}
Goals: ${JSON.stringify(p.goals)}

Return ONLY valid JSON:
{"monthlyBudget":{"totalIncome":${p.summary.monthlyIncome},"totalExpenses":${p.summary.monthlyExpenses},"totalSavings":${p.summary.netCashFlow},"categories":[{"name":"","budgeted":0,"type":"expense"}]},"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"monthlyReview":"","topRecommendation":"","topRecommendation_fr":""}

Rules:
- Use the VERIFIED numbers exactly. totalIncome MUST equal ${p.summary.monthlyIncome}, totalExpenses MUST equal ${p.summary.monthlyExpenses}, totalSavings MUST equal ${p.summary.netCashFlow}.
- Populate categories from the actual income, fixed, and variable lines provided.
- Populate sinkingFunds from the provided sinking fund lines (keep their exact amounts).
- Populate goals from the provided goals. Mark onTrack true if savedSoFar > 0 or net cash flow comfortably covers the monthly contribution needed.
- Household info tells you province, kids, RRSP/RESP/TFSA status, employer province. USE IT: if Quebec resident with Ontario employer, flag the provincial tax gap. If kids and no RESP, recommend $2,500/yr per child for the $500 CESG.
- monthlyReview: four paragraphs max, specific numbers from the verified data, one clear recommendation, plain language, like a letter from a financial advisor. Good tone: "This month your budget looks solid." NOT corporate jargon.
- If net cash flow is negative, the top recommendation must address that first.
- Separate paragraphs in monthlyReview with \\n`;
    } else {
      // Generic path: analysis + answers (existing behavior)
      const { analysis, answers } = body;
      prompt = `You are Phare, an AI financial coach for Canadian families. You analyzed a family's data and they answered your questions. Now build their complete financial plan.

Analysis:
${JSON.stringify(analysis)}

Their answers:
${JSON.stringify(answers)}

Return ONLY valid JSON:
{"monthlyBudget":{"totalIncome":0,"totalExpenses":0,"totalSavings":0,"categories":[{"name":"","budgeted":0,"type":"expense"}]},"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"monthlyReview":"","topRecommendation":"","topRecommendation_fr":""}

Rules:
- Use real numbers from the analysis and answers, never invent
- RRSP: if Quebec resident with Ontario employer, suggest RRSP to offset provincial tax gap
- RESP: if children and no RESP, recommend $2,500/year per child for full $500 CESG
- TFSA: suggest for sinking funds and short-term goals
- Sinking funds: property tax (March & June in Quebec), car registration, back to school, income tax balance
- monthlyReview: four paragraphs max, specific numbers, one recommendation, plain language, like a letter from a financial advisor.
- If no debt, set debtPayoff to null.
- Separate paragraphs in monthlyReview with \\n`;
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    const plan = JSON.parse(responseText.replace(/```json|```/g, '').trim());

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('Plan generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate financial plan' },
      { status: 500 }
    );
  }
}
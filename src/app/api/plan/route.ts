import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    let prompt: string;

    if (body.source === 'template') {
      // Template path: numbers verified by code. Claude ONLY interprets.
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
{"monthlyBudget":{"totalIncome":${p.summary.monthlyIncome},"totalExpenses":${p.summary.monthlyExpenses},"totalSavings":${p.summary.netCashFlow},"categories":[{"name":"","budgeted":0,"type":"expense"}]},"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"topRecommendation":"","topRecommendation_fr":""}

Rules:
- Use the VERIFIED numbers exactly. totalIncome MUST equal ${p.summary.monthlyIncome}, totalExpenses MUST equal ${p.summary.monthlyExpenses}, totalSavings MUST equal ${p.summary.netCashFlow}.
- Populate categories from the actual income, fixed, and variable lines provided.
- Populate sinkingFunds from the provided sinking fund lines (keep their exact amounts).
- Populate goals from the provided goals. Mark onTrack true if savedSoFar > 0 or net cash flow comfortably covers the monthly contribution needed.
- Household info tells you province, kids, RRSP/RESP/TFSA status, employer province. USE IT: if Quebec resident with Ontario employer, flag the provincial tax gap. If kids and no RESP, recommend $2,500/yr per child for the $500 CESG.
- If net cash flow is negative, the top recommendation must address that first.`;
    } else if (body.source === 'calculated') {
      // Own-file or manual form: numbers verified by the calculator. Claude ONLY interprets.
      const c = body.calculated;
      prompt = `You are Phare, an AI financial coach for Canadian families. The numbers below were computed directly from the family's data and are VERIFIED and EXACT. Do NOT change, recalculate, or invent any numbers — use these exactly as given.

VERIFIED DATA:
Monthly income: $${c.income.total} (lines: ${JSON.stringify(c.income.lines)})
Monthly expenses: $${c.expenses.total} (lines: ${JSON.stringify(c.expenses.lines)})
Net cash flow: $${c.netCashFlow}

Return ONLY valid JSON:
{"monthlyBudget":{"totalIncome":${c.income.total},"totalExpenses":${c.expenses.total},"totalSavings":${c.netCashFlow},"categories":[{"name":"","budgeted":0,"type":"expense"}]},"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"topRecommendation":"","topRecommendation_fr":""}

Rules:
- Use the VERIFIED numbers exactly. totalIncome MUST equal ${c.income.total}, totalExpenses MUST equal ${c.expenses.total}, totalSavings MUST equal ${c.netCashFlow}.
- Populate categories from the actual income and expense lines provided. Do not add lines that aren't there.
- Suggest sinkingFunds for likely Canadian annual expenses you can infer from the expense labels (property tax, car registration, back to school, income tax balance).
- Apply Canadian context: RRSP reduces taxable income; RESP gives $500/yr CESG per child; TFSA is ideal for sinking funds. If you see signs of children or a mortgage in the labels, factor that in.
- If net cash flow is negative, the top recommendation must address that first.
- If you cannot determine something (e.g. number of children), do NOT invent it — speak generally instead.
- If no debt is evident, set debtPayoff to null.`;
    } else {
      return NextResponse.json(
        { error: 'Unknown plan source' },
        { status: 400 }
      );
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
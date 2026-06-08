import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { analysis, answers } = await request.json();

    const prompt = `You are Phare, an AI financial coach for Canadian families. You analyzed a family's data and they answered your questions. Now build their complete financial plan.

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
- Bi-weekly pay: 4 months/year have 3 paycheques — treat as windfall months
- monthlyReview: four paragraphs max, specific numbers, one recommendation, plain language, feels like a letter from a financial advisor. Good tone: "June was a solid month overall." NOT "Based on comprehensive analysis."
- Be specific. Use dollar amounts. If no debt, set debtPayoff to null.
- Separate paragraphs in monthlyReview with \\n`;

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
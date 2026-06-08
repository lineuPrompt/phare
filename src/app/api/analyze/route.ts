import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { sheets, fileName } = await request.json();

    // Keep only essential data — 5 sample rows, column names, row count
    const slim = sheets.map((s: { sheet: string; rowCount: number; columns: string[]; sampleRows: Record<string, unknown>[] }) => ({
      sheet: s.sheet,
      rows: s.rowCount,
      columns: s.columns?.slice(0, 10) || [],
      sample: (s.sampleRows || []).slice(0, 5),
    }));

    const prompt = `You are Phare, an AI financial coach for Canadian families. Analyze this uploaded file "${fileName}".

Data:
${JSON.stringify(slim)}

Return ONLY valid JSON:
{"summary":{"monthsDetected":0,"totalIncome":0,"totalExpenses":0,"netCashFlow":0,"currency":"CAD"},"categories":[{"name":"","name_fr":"","type":"expense","monthlyAverage":0,"confidence":"high"}],"insights":[{"type":"warning","title":"","title_fr":"","description":"","description_fr":""}],"suggestedSinkingFunds":[{"name":"","name_fr":"","annualAmount":0,"monthlyProvision":0,"reason":"","reason_fr":""}],"questions":[{"question":"","question_fr":"","reason":""}]}

Rules: Use Canadian context (RRSP, RESP, TFSA, CESG). Flag Quebec patterns. Suggest sinking funds for annual expenses. Be specific with numbers. If data is ambiguous, ask a question. Max 3 insights, 3 sinking funds, 5 questions.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    const analysis = JSON.parse(responseText.replace(/```json|```/g, '').trim());

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze financial data' },
      { status: 500 }
    );
  }
}
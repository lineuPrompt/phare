import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { sheets, fileName } = await request.json();

    const prompt = `You are Phare, an AI financial coach for Canadian families. A family just uploaded their financial file "${fileName}".

Here is the data extracted from their file:

${JSON.stringify(sheets.map((s: { sheet: string; rowCount: number; columns: string[]; sampleRows: Record<string, unknown>[] }) => ({
      sheet: s.sheet,
      rowCount: s.rowCount,
      columns: s.columns,
      sampleRows: s.sampleRows.slice(0, 3),
    })), null, 2)}

Your job is to analyze this data and return a JSON response with the following structure. Return ONLY valid JSON, no markdown, no backticks, no explanation:

{
  "summary": {
    "monthsDetected": number,
    "totalIncome": number,
    "totalExpenses": number,
    "netCashFlow": number,
    "currency": "CAD"
  },
  "categories": [
    {
      "name": "Category name",
      "name_fr": "French name",
      "type": "expense" or "income",
      "monthlyAverage": number,
      "confidence": "high" or "medium" or "low"
    }
  ],
  "insights": [
    {
      "type": "warning" or "opportunity" or "positive",
      "title": "Short title",
      "title_fr": "French title",
      "description": "One sentence explanation with specific numbers",
      "description_fr": "French translation"
    }
  ],
  "suggestedSinkingFunds": [
    {
      "name": "Fund name",
      "name_fr": "French name",
      "annualAmount": number,
      "monthlyProvision": number,
      "reason": "Why this fund is needed",
      "reason_fr": "French translation"
    }
  ],
  "questions": [
    {
      "question": "Question to ask the family to fill gaps",
      "question_fr": "French translation",
      "reason": "Why you need this information"
    }
  ]
}

Rules:
- Use Canadian financial context: RRSP, RESP, TFSA, CESG
- If you see Quebec-specific patterns (provincial tax, municipal taxes in March/June), flag them
- Detect if the family might be missing RESP contributions (leaving $500/year CESG unclaimed per child)
- Identify expenses that look like annual irregular costs and suggest sinking funds
- Be specific with numbers, never vague
- If data is ambiguous, add a question instead of guessing
- Categories with "low" confidence should have a corresponding question`;

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
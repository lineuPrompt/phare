import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { parseTemplate, isPhareTemplate } from '@/lib/templateParser';
import { calculateFinancials, extractLabelAmountPairs } from '@/lib/calculator';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const mode = (formData.get('mode') as string) || 'own'; // 'template' or 'own'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload CSV or Excel.' },
        { status: 400 }
      );
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;

    // MODE: Phare template
    if (mode === 'template') {
      if (!isPhareTemplate(sheetNames)) {
        return NextResponse.json({
          source: 'template_mismatch',
          message: 'This does not look like the Phare template.',
        });
      }
      const parsed = parseTemplate(buffer);
      return NextResponse.json({
        fileName: file.name,
        source: 'template',
        parsed,
      });
    }

    // MODE: Own file — try the calculator across all sheets
    let bestResult = null;
    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
      const pairs = extractLabelAmountPairs(rows);
      const result = calculateFinancials(pairs);
      if (result.confidence === 'high') {
        bestResult = result;
        break;
      }
    }

    if (bestResult) {
      return NextResponse.json({
        fileName: file.name,
        source: 'calculated',
        calculated: bestResult,
      });
    }

    // Calculator could not parse confidently → tell frontend to show the form
    return NextResponse.json({
      fileName: file.name,
      source: 'needs_form',
    });
  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process file' },
      { status: 500 }
    );
  }
}
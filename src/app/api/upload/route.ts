import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { parseTemplate, isPhareTemplate, isValidV3Template } from '@/lib/templateParser';

/**
 * Onboarding accepts exactly two inputs: the Phare template and manual
 * entry. This route is the template half — there is no generic/arbitrary-
 * file path. The contract is exact-match-or-refuse: a file either is the
 * current (v3) template, or it's refused with a specific reason, never
 * partially parsed. A wrong-version upload "succeeding" with expenses
 * silently collapsed to monthly is the exact failure this refuses to risk.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload the Phare template (.xlsx).' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (!isPhareTemplate(workbook.SheetNames)) {
      return NextResponse.json({
        source: 'template_mismatch',
        reason: 'wrong_file',
      });
    }
    if (!isValidV3Template(workbook)) {
      return NextResponse.json({
        source: 'template_mismatch',
        reason: 'outdated_template',
      });
    }

    const parsed = parseTemplate(buffer);
    return NextResponse.json({
      fileName: file.name,
      source: 'template',
      parsed,
    });
  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process file' },
      { status: 500 }
    );
  }
}

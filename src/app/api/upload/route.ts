import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { parseTemplate, isPhareTemplate, isValidV3Template } from '@/lib/templateParser';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';

// Unauthenticated (pre-signup) and no Anthropic spend, but it does read and
// parse an arbitrary uploaded workbook — real CPU per call. Limited loosely,
// because this is the one onboarding route a legitimate user fires repeatedly:
// a wrong-file or outdated-template response is a 200 that sends them back to
// re-download and drop again, so 3–5 uploads in a few minutes is a normal
// first-time session. 20 per 5 minutes leaves that ample room.
const rateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

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
    const limit = rateLimit(clientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait a moment and try again.', retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

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

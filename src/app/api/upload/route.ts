import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { parseTemplate, isPhareTemplate, isValidV3Template } from '@/lib/templateParser';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import { requireOnboardingSession } from '@/lib/onboardingAuth';

// AUTHENTICATED, but deliberately NOT quota'd.
//
// The old comment called this route "pre-signup". That was factually wrong:
// signup creates the household and onboarding runs after it, which is why the
// same page calls /api/household/members — a 401-guarded route — three lines
// after this one. It now requires a session like its neighbours.
//
// No monthly allowance, on purpose. This route spends no Anthropic tokens; it
// parses a workbook, which is CPU already bounded by the body-size cap. And it
// is the ONE onboarding route a legitimate user fires repeatedly — a
// wrong-file or outdated-template answer is a 200 that sends them back to
// re-download and drop again, so 3-5 uploads in a few minutes is a normal
// first session. A monthly counter here would refuse honest people to bound
// something that is already bounded.
//
// The IP limiter stays as an in-process burst damper. It does not bind across
// instances and is not the ceiling.
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

    // Identity only — no allowance is consumed here. See the header.
    const auth = await requireOnboardingSession();
    if (!auth.ok) return auth.response;

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

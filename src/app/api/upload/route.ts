import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let data: Record<string, unknown>[][] = [];
    let sheetNames: string[] = [];

    if (fileName.endsWith('.csv')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      sheetNames = workbook.SheetNames;
      data = sheetNames.map((name) =>
        XLSX.utils.sheet_to_json(workbook.Sheets[name])
      );
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      sheetNames = workbook.SheetNames;
      data = sheetNames.map((name) =>
        XLSX.utils.sheet_to_json(workbook.Sheets[name])
      );
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload CSV or Excel.' },
        { status: 400 }
      );
    }

    // Build a summary for the AI
    const summary = sheetNames.map((name, i) => ({
      sheet: name,
      rowCount: data[i].length,
      columns: data[i].length > 0 ? Object.keys(data[i][0]) : [],
      sampleRows: data[i].slice(0, 5),
    }));

    return NextResponse.json({
      fileName: file.name,
      sheets: summary,
      rawData: data,
    });
  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process file' },
      { status: 500 }
    );
  }
}
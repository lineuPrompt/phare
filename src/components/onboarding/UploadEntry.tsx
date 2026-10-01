'use client';

import { useTranslations } from 'next-intl';

/**
 * Onboarding accepts exactly two inputs: step-by-step manual entry and the
 * Phare template. Step-by-step is the primary action (2026-10-01): first on
 * the page, the large button. The template — download, then drop — sits
 * below it as the secondary option for people who prefer a spreadsheet.
 *
 * Layout and copy only: the handlers are the same props as before, so the
 * same funnel events fire (path_chosen manual from onManual, template from a
 * dropped or picked file, template_downloaded from the download link).
 */
export default function UploadEntry({
  dragOver,
  setDragOver,
  onDrop,
  onFileSelect,
  onManual,
  onTemplateDownload,
}: {
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onManual: () => void;
  onTemplateDownload: () => void;
}) {
  const t = useTranslations('upload');

  return (
    <div className="space-y-10">
      {/* Primary: step-by-step entry */}
      <div className="rounded-2xl p-10 text-center" style={{ background: 'white', border: '2px solid #0F2044' }}>
        <div className="text-4xl mb-4">📝</div>
        <p className="text-xl font-bold mb-2" style={{ color: '#0F2044' }}>{t('entry.manualTitle')}</p>
        <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: '#6B7280' }}>{t('entry.manualDescription')}</p>
        <button
          onClick={onManual}
          className="px-10 py-3.5 rounded-full text-lg font-semibold cursor-pointer transition-all hover:opacity-90"
          style={{ background: '#0F2044', color: 'white' }}
        >
          {t('entry.manualCta')}
        </button>
      </div>

      {/* Secondary: import from the template */}
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-base font-medium mb-1" style={{ color: '#0F2044' }}>{t('entry.spreadsheetTitle')}</p>
          <p className="text-sm mb-3" style={{ color: '#6B7280' }}>{t('entry.spreadsheetDescription')}</p>
          <a href="/phare_template.xlsx" download onClick={onTemplateDownload}
            className="inline-block px-5 py-2 rounded-full text-sm font-medium cursor-pointer transition-all hover:opacity-80"
            style={{ border: '1.5px solid #2ABFBF', color: '#0F2044' }}>
            {t('noFile.cta')}
          </a>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className="rounded-2xl p-8 text-center cursor-pointer transition-all"
          style={{
            border: `2px dashed ${dragOver ? '#2ABFBF' : '#D1D5DB'}`,
            background: dragOver ? '#F0FDFD' : 'white',
          }}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm font-medium mb-1" style={{ color: '#0F2044' }}>{t('dropzone')}</p>
          <p className="text-xs" style={{ color: '#6B7280' }}>{t('formats')}</p>
          <input id="file-input" type="file" accept=".xlsx,.xls" onChange={onFileSelect} className="hidden" />
        </div>
      </div>
    </div>
  );
}

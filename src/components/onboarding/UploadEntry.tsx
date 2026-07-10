'use client';

import { useTranslations } from 'next-intl';

/**
 * Onboarding accepts exactly two inputs: the Phare template and manual
 * entry. No generic-file mode, no "bank statement" promise — the template
 * download is the primary path, front and centre.
 */
export default function UploadEntry({
  dragOver,
  setDragOver,
  onDrop,
  onFileSelect,
  onManual,
}: {
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onManual: () => void;
}) {
  const t = useTranslations('upload');

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-8 text-center" style={{ background: '#F0FDFD', border: '1px solid #D1FAE5' }}>
        <div className="text-4xl mb-4">📝</div>
        <p className="text-lg font-medium mb-2" style={{ color: '#0F2044' }}>{t('noFile.title')}</p>
        <p className="text-sm mb-4" style={{ color: '#6B7280' }}>{t('noFile.description')}</p>
        <a href="/phare_template.xlsx" download
          className="inline-block px-6 py-2.5 rounded-full font-medium cursor-pointer transition-all hover:opacity-90"
          style={{ background: '#2ABFBF', color: '#0F2044' }}>
          {t('noFile.cta')}
        </a>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: '#E5E7EB' }} />
        <span className="text-sm" style={{ color: '#9CA3AF' }}>{t('or')}</span>
        <div className="flex-1 h-px" style={{ background: '#E5E7EB' }} />
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className="rounded-2xl p-16 text-center cursor-pointer transition-all"
        style={{
          border: `2px dashed ${dragOver ? '#2ABFBF' : '#D1D5DB'}`,
          background: dragOver ? '#F0FDFD' : 'white',
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div className="text-5xl mb-4">📄</div>
        <p className="text-lg font-medium mb-2" style={{ color: '#0F2044' }}>{t('dropzone')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('formats')}</p>
        <input id="file-input" type="file" accept=".xlsx,.xls" onChange={onFileSelect} className="hidden" />
      </div>

      <div className="text-center">
        <button onClick={onManual} className="text-sm font-medium underline cursor-pointer" style={{ color: '#6B7280' }}>
          {t('noFile.manual')}
        </button>
      </div>
    </div>
  );
}

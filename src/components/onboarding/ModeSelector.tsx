'use client';

import { useTranslations } from 'next-intl';

export default function ModeSelector({
  mode,
  setMode,
  dragOver,
  setDragOver,
  onDrop,
  onFileSelect,
  onManual,
}: {
  mode: 'template' | 'own';
  setMode: (m: 'template' | 'own') => void;
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onManual: () => void;
}) {
  const t = useTranslations('upload');

  const ModeCard = ({ value, label, desc }: { value: 'own' | 'template'; label: string; desc: string }) => (
    <button
      onClick={() => setMode(value)}
      className="flex-1 rounded-xl p-4 text-left transition-all cursor-pointer"
      style={{
        border: mode === value ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
        background: mode === value ? '#F0FDFD' : 'white',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
          style={{ border: `2px solid ${mode === value ? '#2ABFBF' : '#D1D5DB'}` }}>
          {mode === value && <span className="w-2 h-2 rounded-full" style={{ background: '#2ABFBF' }} />}
        </span>
        <span className="font-semibold" style={{ color: '#0F2044' }}>{label}</span>
      </div>
      <p className="text-sm ml-6" style={{ color: '#6B7280' }}>{desc}</p>
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <ModeCard value="own" label={t('mode.own')} desc={t('mode.ownDesc')} />
        <ModeCard value="template" label={t('mode.template')} desc={t('mode.templateDesc')} />
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
        <input id="file-input" type="file" accept=".csv,.xlsx,.xls" onChange={onFileSelect} className="hidden" />
      </div>

      {mode === 'template' && (
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
      )}

      <div className="text-center">
        <button onClick={onManual} className="text-sm font-medium underline cursor-pointer" style={{ color: '#6B7280' }}>
          {t('noFile.manual')}
        </button>
      </div>
    </div>
  );
}
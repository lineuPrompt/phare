/**
 * The /upload entry screen, rendered with the real messages in both locales
 * (react-dom/server). next-intl throws on a missing key, so a key that does
 * not resolve fails here. 2026-10-01: step-by-step entry is the primary
 * action, the template the secondary one — layout and copy only.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import UploadEntry from '../UploadEntry';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

const MESSAGES = { en, fr } as const;
const noop = () => {};

function render(locale: 'en' | 'fr') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <UploadEntry
        dragOver={false}
        setDragOver={noop}
        onDrop={noop}
        onFileSelect={noop}
        onManual={noop}
        onTemplateDownload={noop}
      />
    </NextIntlClientProvider>
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

describe('UploadEntry — step-by-step first, the template second', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`${locale}: the step-by-step button comes before the template download and the drop zone`, () => {
      const html = render(locale);
      const m = MESSAGES[locale].upload;
      const manualButton = html.indexOf(`>${m.entry.manualCta}</button>`);
      const spreadsheet = html.indexOf(m.entry.spreadsheetTitle);
      const download = html.indexOf('href="/phare_template.xlsx"');
      const dropInput = html.indexOf('id="file-input"');
      expect(manualButton).toBeGreaterThan(-1);
      expect(spreadsheet).toBeGreaterThan(manualButton);
      expect(download).toBeGreaterThan(spreadsheet);
      expect(dropInput).toBeGreaterThan(download);
    });

    it(`${locale}: both options are still there, unchanged in function`, () => {
      const html = render(locale);
      expect(html.match(/<button/g)?.length).toBe(1);                 // the one primary button
      expect(html).toContain('href="/phare_template.xlsx"');          // same download
      expect(html).toMatch(/<input[^>]*type="file"[^>]*accept=".xlsx,.xls"/); // same file picker
    });
  }

  it('reads naturally in both languages', () => {
    const shown = { en: text(render('en')), fr: text(render('fr')) };
    expect(shown.en).toContain('Enter your numbers step by step');
    expect(shown.en).toContain('Prefer a spreadsheet?');
    expect(shown.fr).toContain('Entrez vos chiffres étape par étape');
    expect(shown.fr).toContain('Vous préférez un tableur?');
  });
});

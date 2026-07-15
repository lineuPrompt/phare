import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../en.json';
import fr from '../fr.json';

/**
 * Global key-resolution test: every `t('some.key')` reachable from a
 * `const t = useTranslations('namespace')` (any variable name — some
 * files bind a second instance like `tDash`/`tGoals`) must resolve to a
 * non-empty string in BOTH locale files.
 *
 * This is plain string extraction against the parsed JSON, not a type
 * checker — it exists specifically to catch the class of bug where a
 * duplicate top-level JSON key silently shadows an earlier one (JSON.parse
 * keeps the last occurrence), so a namespace can look present while every
 * key under the real definition 404s. Coverage is global (all of src/),
 * not scoped to one feature — the failure mode here is a JSON-file-level
 * collision, which can just as easily happen next to any other section as
 * it did next to "timeline".
 *
 * Known, accepted gaps (can't be resolved by string extraction alone):
 *   - dynamic keys built from a variable/template literal, e.g.
 *     `tGoals(\`type.${goal.type}\`)`, are skipped — the literal isn't
 *     known until runtime.
 *   - a key is accepted if it resolves under ANY namespace declared for
 *     that variable name in the file (handles a var reused across
 *     multiple components in one file); this can't misidentify a missing
 *     key as present unless two same-named t-instances in one file
 *     coincidentally share a resolvable key, which would itself mean the
 *     copy in that file is highly ambiguous and worth a human look anyway.
 */

const SRC_DIR = path.resolve(process.cwd(), 'src');

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { recursive: true }) as string[];
  return entries
    .filter((entry) => /\.(tsx|ts)$/.test(entry))
    .filter((entry) => !entry.split(path.sep).join('/').includes('__tests__'))
    .filter((entry) => !entry.includes('.test.'))
    .map((entry) => path.join(dir, entry));
}

type Declaration = { varName: string; namespace: string };

function extractDeclarations(src: string): Declaration[] {
  const decls: Declaration[] = [];
  const re = /\b(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*['"]([\w.]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    decls.push({ varName: m[1], namespace: m[2] });
  }
  return decls;
}

function extractCalls(src: string, varNames: Set<string>): { varName: string; key: string }[] {
  const calls: { varName: string; key: string }[] = [];
  const re = /\b(\w+)\(\s*['"]([\w.]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (varNames.has(m[1])) calls.push({ varName: m[1], key: m[2] });
  }
  return calls;
}

function resolvePath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function resolves(obj: unknown, dotted: string): boolean {
  const v = resolvePath(obj, dotted);
  return typeof v === 'string' && v.length > 0;
}

describe('i18n key resolution — every t() key referenced in src/ resolves in en.json and fr.json', () => {
  it('has no missing or empty keys', () => {
    const files = listSourceFiles(SRC_DIR);
    const failures: string[] = [];
    let checkedCalls = 0;

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('useTranslations(')) continue;

      const decls = extractDeclarations(src);
      if (decls.length === 0) continue;

      const namespacesByVar = new Map<string, string[]>();
      for (const d of decls) {
        const list = namespacesByVar.get(d.varName) ?? [];
        list.push(d.namespace);
        namespacesByVar.set(d.varName, list);
      }

      const calls = extractCalls(src, new Set(namespacesByVar.keys()));
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');

      for (const call of calls) {
        const namespaces = namespacesByVar.get(call.varName) ?? [];
        const candidates = namespaces.map((ns) => `${ns}.${call.key}`);
        checkedCalls++;

        const okEn = candidates.some((p) => resolves(en, p));
        const okFr = candidates.some((p) => resolves(fr, p));

        if (!okEn) failures.push(`${rel}: ${call.varName}('${call.key}') → tried [${candidates.join(', ')}] — missing/empty in en.json`);
        if (!okFr) failures.push(`${rel}: ${call.varName}('${call.key}') → tried [${candidates.join(', ')}] — missing/empty in fr.json`);
      }
    }

    // Sanity guard: if extraction itself breaks (e.g. no files found), the
    // test would pass vacuously — assert we actually checked something.
    expect(checkedCalls).toBeGreaterThan(50);

    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });

  it('rejects duplicate top-level keys in either locale file (the actual root cause seen in production)', () => {
    for (const [label, filePath] of [
      ['en.json', path.join(SRC_DIR, 'messages', 'en.json')],
      ['fr.json', path.join(SRC_DIR, 'messages', 'fr.json')],
    ] as const) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const topLevelKeyRe = /^\s{2}"([\w.]+)":/gm; // 2-space-indented keys = top-level object keys in this file's formatting
      const seen = new Map<string, number>();
      let m: RegExpExecArray | null;
      while ((m = topLevelKeyRe.exec(raw))) {
        seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
      expect(dupes, `${label} has duplicate top-level keys: ${dupes.join(', ')}`).toEqual([]);
    }
  });
});

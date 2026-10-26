/**
 *   tsx src/cli.ts parse <MagicCompRules.txt> <rules.json>
 *   tsx src/cli.ts trace [--check]
 *
 * `trace` scans packages/engine/src (implemented) and packages/engine/test (tested)
 * for "CR x.y" citations and writes docs/rules/TRACE.md. With --check it exits 1
 * when a citation names a rule that doesn't exist in docs/rules/rules.json.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseComprehensiveRules, type RulesDoc } from './parse.js';
import { buildTrace, findCitations, traceMarkdown, type Citation } from './trace.js';

const root = resolve(process.env.INIT_CWD ?? process.cwd());
const fromRoot = (p: string) => resolve(root, p);

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

async function parse(input: string, output: string): Promise<void> {
  const doc = parseComprehensiveRules(await readFile(fromRoot(input), 'utf8'));
  const count = Object.keys(doc.rules).length;
  if (count < 1000) throw new Error(`only ${count} rules parsed — the file format may have changed`);
  await writeFile(fromRoot(output), JSON.stringify(doc, null, 1) + '\n');
  console.log(
    `parsed ${count} rules, ${Object.keys(doc.glossary).length} glossary terms, effective ${doc.effectiveDate ?? 'unknown'} → ${output}`,
  );
}

async function trace(check: boolean): Promise<void> {
  const rulesPath = fromRoot('docs/rules/rules.json');
  const doc: RulesDoc | null = existsSync(rulesPath) ? JSON.parse(await readFile(rulesPath, 'utf8')) : null;
  const citations: Citation[] = [];
  for (const [dir, kind] of [
    ['packages/engine/src', 'code'],
    ['packages/engine/test', 'test'],
  ] as const) {
    for (const file of await walk(fromRoot(dir))) {
      citations.push(...findCitations(await readFile(file, 'utf8'), relative(root, file), kind));
    }
  }
  const report = buildTrace(doc, citations);
  await writeFile(fromRoot('docs/rules/TRACE.md'), traceMarkdown(report, doc));
  console.log(
    `${report.rows.length} rules cited (${citations.length} citations)` +
      (doc ? `, ${report.unknown.length} unknown` : ' — rules.json missing, citations unchecked'),
  );
  if (check && report.unknown.length) {
    for (const c of report.unknown) console.error(`unknown rule CR ${c.rule} at ${c.file}:${c.line}`);
    process.exit(1);
  }
}

const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--');
const run =
  cmd === 'parse' && args.length >= 2
    ? parse(args[0]!, args[1]!)
    : cmd === 'trace'
      ? trace(args.includes('--check'))
      : Promise.reject(new Error('usage: cli parse <in.txt> <out.json> | cli trace [--check]'));
run.catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

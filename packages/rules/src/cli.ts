/**
 *   tsx src/cli.ts parse <MagicCompRules.txt> <rules.json>
 *   tsx src/cli.ts trace [--check]
 *   tsx src/cli.ts pin [rule…]
 *   tsx src/cli.ts diff <older rules.json>
 *   tsx src/cli.ts subtypes
 *   tsx src/cli.ts keywords
 *
 * `trace` scans the engine and the compiler (implemented), their tests (tested) and the rule checks random games run
 * (packages/engine/scripts/lib/rule-checks.ts) for "CR x.y" citations and writes docs/rules/TRACE.md. It also keeps
 * docs/rules/PINNED.json: the text of each cited rule as it was when it was first cited or last looked at.
 *
 * With --check it exits 1 when a citation names a rule that doesn't exist in docs/rules/rules.json, or when a cited
 * rule no longer reads as it is pinned — the rules changed under code that cites them. Read the rule, change what it
 * changes, then `pin` (all changed rules, or the ones named) to say it has been looked at.
 *
 * `diff` lists what a newer rules.json adds, removes and rewords against an older one (for a new set's rules).
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseComprehensiveRules, type RulesDoc } from './parse.js';
import { actionDefinitionsModule, extractActionDefinitions, extractKeywordDefinitions, keywordDefinitionsModule, sectionNames } from './keywords.js';
import { extractSubtypes, subtypesModule } from './subtypes.js';
import { buildTrace, diffRules, findCitations, findRuleChecks, pinned, pinProblems, traceMarkdown, type Citation, type Pins, type TraceReport } from './trace.js';

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

const PINS = 'docs/rules/PINNED.json';
const RULE_CHECKS = 'packages/engine/scripts/lib/rule-checks.ts';

async function readRules(): Promise<RulesDoc | null> {
  const rulesPath = fromRoot('docs/rules/rules.json');
  return existsSync(rulesPath) ? (JSON.parse(await readFile(rulesPath, 'utf8')) as RulesDoc) : null;
}

async function readPins(): Promise<Pins> {
  return existsSync(fromRoot(PINS)) ? (JSON.parse(await readFile(fromRoot(PINS), 'utf8')) as Pins) : { rules: {} };
}

const writePins = (pins: Pins) => writeFile(fromRoot(PINS), JSON.stringify(pins, null, 1) + '\n');

/** Every citation: in the engine and the compiler, in their tests, and in the rules random games check. */
async function cite(doc: RulesDoc | null): Promise<{ citations: Citation[]; report: TraceReport }> {
  const citations: Citation[] = [];
  for (const [dir, kind] of [
    ['packages/engine/src', 'code'],
    ['packages/compiler/src', 'code'],
    ['packages/engine/test', 'test'],
    ['packages/compiler/test', 'test'],
  ] as const) {
    for (const file of await walk(fromRoot(dir))) {
      citations.push(...findCitations(await readFile(file, 'utf8'), relative(root, file), kind));
    }
  }
  if (existsSync(fromRoot(RULE_CHECKS))) citations.push(...findRuleChecks(await readFile(fromRoot(RULE_CHECKS), 'utf8'), RULE_CHECKS));
  return { citations, report: buildTrace(doc, citations) };
}

async function trace(check: boolean): Promise<void> {
  const doc = await readRules();
  const { citations, report } = await cite(doc);
  console.log(
    `${report.rows.length} rules cited (${citations.length} citations)` +
      (doc ? `, ${report.unknown.length} unknown` : ' — rules.json missing, citations unchecked'),
  );
  if (!check) {
    await writeFile(fromRoot('docs/rules/TRACE.md'), traceMarkdown(report, doc));
    // A rule cited for the first time is pinned as it reads now; a pin there already is left as it is.
    if (doc) await writePins(pinned(doc, await readPins(), report));
    return;
  }
  for (const c of report.unknown) console.error(`unknown rule CR ${c.rule} at ${c.file}:${c.line}`);
  const problems = doc ? pinProblems(doc, await readPins(), report) : [];
  // The rule stated as a property comes first: that entry restates the rule, and is the one sure to need changing.
  const where = (cs: Citation[]) => {
    const places = [...new Set([...cs.filter((c) => c.kind === 'check'), ...cs.filter((c) => c.kind !== 'check')].map((c) => `${c.file}:${c.line}`))];
    return places.slice(0, 6).join(', ') + (places.length > 6 ? `, and ${places.length - 6} more` : '');
  };
  for (const p of problems.filter((x) => x.kind === 'changed')) {
    console.error(`CR ${p.rule} has changed since the code citing it was last looked at (${where(p.cited)})\n   was: ${p.was}\n   now: ${p.now}`);
  }
  const unpinned = problems.filter((x) => x.kind === 'unpinned');
  if (unpinned.length) console.error(`${unpinned.length} cited rule(s) aren't pinned yet (${unpinned.slice(0, 8).map((p) => p.rule).join(', ')}…): run \`pnpm rules:trace\``);
  if (problems.some((x) => x.kind === 'changed')) console.error('Read each rule above against what cites it, change what it changes, then `pnpm rules:pin`.');
  if (report.unknown.length || problems.length) process.exit(1);
}

/** Says the changed rules have been looked at: pins them (all, or the ones named) as they read now. */
async function pin(only: string[]): Promise<void> {
  const doc = await readRules();
  if (!doc) throw new Error('docs/rules/rules.json is missing');
  const { report } = await cite(doc);
  const before = await readPins();
  const changed = pinProblems(doc, before, report).filter((p) => p.kind === 'changed' && (!only.length || only.includes(p.rule)));
  await writePins(pinned(doc, before, report, true, only.length ? new Set(only) : undefined));
  console.log(changed.length ? `pinned ${changed.length} rule(s) as they read now: ${changed.map((p) => p.rule).join(', ')}` : 'nothing had changed');
}

/** What the rules now add, remove and reword against an older rules.json — and which of those the code cites. */
async function diff(olderPath: string): Promise<void> {
  const doc = await readRules();
  if (!doc) throw new Error('docs/rules/rules.json is missing');
  const older = JSON.parse(await readFile(fromRoot(olderPath), 'utf8')) as RulesDoc;
  const { report } = await cite(doc);
  const cited = new Map(report.rows.map((r) => [r.rule, r]));
  const d = diffRules(older, doc);
  console.log(`rules effective ${older.effectiveDate ?? '?'} → ${doc.effectiveDate ?? '?'}: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} reworded`);
  const line = (id: string, text: string) => `  ${id}${cited.has(id) ? ' [cited]' : ''}  ${text.split('\n')[0]!.slice(0, 150)}`;
  if (d.added.length) console.log(['added:', ...d.added.map((id) => line(id, doc.rules[id]!.text))].join('\n'));
  if (d.removed.length) console.log(['removed:', ...d.removed.map((id) => line(id, older.rules[id]!.text))].join('\n'));
  if (d.changed.length) console.log(['reworded:', ...d.changed.map((id) => line(id, doc.rules[id]!.text))].join('\n'));
}

/** Writes the compiler's subtype lists (CR 205.3) so the parser can tell "Elf" from "Elves". */
async function subtypes(): Promise<void> {
  const doc: RulesDoc = JSON.parse(await readFile(fromRoot('docs/rules/rules.json'), 'utf8'));
  const lists = extractSubtypes(doc);
  const out = 'packages/schema/src/subtypes.ts';
  await writeFile(fromRoot(out), subtypesModule(lists, doc.effectiveDate));
  console.log(Object.entries(lists).map(([k, v]) => `${v.length} ${k}`).join(', ') + ` → ${out}`);
}

/** Writes the keyword definitions (CR 702) and keyword action definitions (CR 701) the compiler expands them with. */
async function keywords(): Promise<void> {
  const doc: RulesDoc = JSON.parse(await readFile(fromRoot('docs/rules/rules.json'), 'utf8'));
  const defs = extractKeywordDefinitions(doc);
  const out = 'packages/compiler/src/keyword-definitions.ts';
  await writeFile(fromRoot(out), keywordDefinitionsModule(defs, doc.effectiveDate, sectionNames(doc, '702')));
  console.log(`${Object.keys(defs).length} keyword definitions → ${out}`);
  // And the keyword actions CR 701 defines the same way (“Recruit” means “…”).
  const actions = extractActionDefinitions(doc);
  const actionsOut = 'packages/compiler/src/action-definitions.ts';
  await writeFile(fromRoot(actionsOut), actionDefinitionsModule(actions, doc.effectiveDate, sectionNames(doc, '701')));
  console.log(`${Object.keys(actions).length} keyword action definitions → ${actionsOut}`);
}

const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--');
const run =
  cmd === 'parse' && args.length >= 2
    ? parse(args[0]!, args[1]!)
    : cmd === 'trace'
      ? trace(args.includes('--check'))
      : cmd === 'pin'
        ? pin(args)
        : cmd === 'diff' && args.length >= 1
          ? diff(args[0]!)
          : cmd === 'subtypes'
        ? subtypes()
        : cmd === 'keywords'
          ? keywords()
          : Promise.reject(new Error('usage: cli parse <in.txt> <out.json> | cli trace [--check] | cli pin [rule…] | cli diff <older rules.json> | cli subtypes | cli keywords'));
run.catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

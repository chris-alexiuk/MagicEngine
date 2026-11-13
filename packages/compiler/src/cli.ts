/**
 * Builds the compiled card DB.
 *
 *   tsx src/cli.ts --input path/to/oracle-cards.json [--printings path/to/default-cards.json] --out dir
 *   tsx src/cli.ts --download [--cache .cache] --out dir
 *
 * `--download` fetches Scryfall's Oracle Cards (one printing of each card: what gets compiled) and Default Cards
 * (every English printing: read only for the other names cards are printed under).
 *
 * Writes to `out`: cards.json.gz, cards.meta.json, coverage.json, coverage.md
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { CardDBMeta } from '@mtg/schema';
import { compileCards } from './compile.js';
import { buildCoverage, coverageMarkdown } from './coverage.js';
import type { AltNameTable } from './printings.js';
import { readAltNames } from './printings-file.js';
import type { ScryfallBulkItem, ScryfallCard } from './scryfall.js';

// Scryfall asks API clients to send a descriptive User-Agent and an Accept header.
const HEADERS = { 'User-Agent': 'MagicEngine/0.1 (card compiler)', Accept: 'application/json' };

interface Args {
  input?: string;
  /** With --input: a file of printings to read alternate names from. */
  printings?: string;
  download: boolean;
  cache: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  // pnpm forwards a literal "--" before script args; ignore it.
  const args: Args = { download: false, cache: '.cache', out: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--printings') args.printings = argv[++i];
    else if (a === '--download') args.download = true;
    else if (a === '--cache') args.cache = argv[++i] ?? args.cache;
    else if (a === '--out') args.out = argv[++i] ?? args.out;
  }
  if (!args.input && !args.download) throw new Error('pass --input <file> or --download');
  return args;
}

/** Resolves paths against the directory pnpm was invoked from, not this package. */
function fromCwd(p: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

/** Downloads one of Scryfall's bulk files (by its documented type) into the cache, streamed to disk. */
async function download(cacheDir: string, type: 'oracle_cards' | 'default_cards'): Promise<{ file: string; updatedAt: string }> {
  const listRes = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  const body = await listRes.text();
  if (!listRes.ok) throw new Error(`bulk-data lookup failed: HTTP ${listRes.status}: ${body.slice(0, 300)}`);
  const list = JSON.parse(body) as { data?: ScryfallBulkItem[] };
  const item = list.data?.find((d) => d.type === type);
  // Scryfall now publishes gzipped JSON Lines; older responses had a plain JSON array.
  const url = item?.jsonl_download_uri ?? item?.download_uri;
  if (!item || !url) throw new Error(`no ${type} download in the bulk-data list: ${body.slice(0, 600)}`);
  const ext = item.jsonl_download_uri ? '.jsonl.gz' : '.json';
  const file = join(cacheDir, `${type.replace('_', '-')}-${item.updated_at.replace(/[:.+]/g, '-')}${ext}`);
  if (existsSync(file)) {
    console.log(`using cached ${file}`);
    return { file, updatedAt: item.updated_at };
  }
  const size = item.compressed_size ?? item.size;
  console.log(`downloading ${size ? `${(size / 1e6).toFixed(0)} MB ` : ''}from ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`bulk download failed: HTTP ${res.status}`);
  await mkdir(cacheDir, { recursive: true });
  // To a temporary name first, so an interrupted download is never mistaken for a cached file.
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(`${file}.part`));
  await rename(`${file}.part`, file);
  return { file, updatedAt: item.updated_at };
}

/**
 * The other names cards are printed under, from a file of printings. The card DB is worth having without them, so a
 * failure here (the download, an unexpected format) is a warning, not the end of the build.
 */
async function altNamesFrom(file: () => Promise<string>): Promise<AltNameTable | undefined> {
  try {
    const { table, printings } = await readAltNames(await file());
    const names = [...table.values()].reduce((n, list) => n + list.length, 0);
    console.log(`alternate names: ${names} on ${table.size} cards (from ${printings} printings)`);
    return table;
  } catch (err) {
    console.warn(`::warning::Alternate card names are missing from this build: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** Reads Scryfall card objects from .json (array), .jsonl or .jsonl.gz / .json.gz. */
async function readCards(path: string): Promise<ScryfallCard[]> {
  let bytes = await readFile(path);
  // Decompress real gzip data only (some servers transparently decompress downloads).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const text = bytes.toString('utf8');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) return JSON.parse(text) as ScryfallCard[];
  const cards: ScryfallCard[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l) cards.push(JSON.parse(l) as ScryfallCard);
  }
  return cards;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = fromCwd(args.out);

  let inputFile: string;
  let updatedAt: string | undefined;
  let altNames: AltNameTable | undefined;
  if (args.download) {
    ({ file: inputFile, updatedAt } = await download(fromCwd(args.cache), 'oracle_cards'));
    altNames = await altNamesFrom(async () => (await download(fromCwd(args.cache), 'default_cards')).file);
  } else {
    inputFile = fromCwd(args.input!);
    if (args.printings) altNames = await altNamesFrom(async () => fromCwd(args.printings!));
  }

  const raw = await readCards(inputFile);
  const started = Date.now();
  const { db, skipped } = compileCards(raw, {
    source: args.download
      ? { kind: 'scryfall-oracle-cards', ...(updatedAt ? { updatedAt } : {}) }
      : { kind: 'fixture' },
    ...(altNames ? { altNames } : {}),
  });
  const report = buildCoverage(db);

  const json = JSON.stringify(db);
  const gz = gzipSync(json, { level: 9 });
  const meta: CardDBMeta = {
    schema: db.schema,
    builtAt: db.builtAt,
    ...(updatedAt ? { sourceUpdatedAt: updatedAt } : {}),
    cardCount: db.cards.length,
    tokenCount: db.tokens.length,
    bytes: gz.length,
    sha256: createHash('sha256').update(gz).digest('hex'),
    coverage: report.totals,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'cards.json.gz'), gz);
  await writeFile(join(outDir, 'cards.meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(join(outDir, 'coverage.json'), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, 'coverage.md'), coverageMarkdown(report));

  const mb = (n: number) => (n / 1e6).toFixed(2);
  console.log(
    `compiled ${db.cards.length} cards + ${db.tokens.length} tokens in ${Date.now() - started} ms\n` +
      `  json ${mb(json.length)} MB → gz ${mb(gz.length)} MB\n` +
      `  coverage: full ${report.totals.full}, partial ${report.totals.partial}, manual ${report.totals.manual}\n` +
      `  cards with other printed names: ${db.cards.filter((c) => c.aka?.length).length}\n` +
      `  skipped: ${JSON.stringify(skipped)}\n` +
      `  wrote ${outDir}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

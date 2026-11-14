/**
 * Taking the last card DB as it is, when a build would only make it again (cli.ts, --reuse).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardDBMeta } from '@mtg/schema';

/**
 * A hash of everything a card's compiled form comes from besides Scryfall's data: the compiler's source and the
 * schema's (keyword definitions and subtype lists included — they are source files).
 */
export function compilerHash(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const hash = createHash('sha256');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const root of [here, resolve(here, '../../schema/src')]) {
    for (const file of walk(root)) hash.update(`${file.slice(root.length)}\n`).update(readFileSync(file)).update('\n');
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * The DB in `dir`, if it is what this build would make: same Oracle Cards file, same printings file, same compiler.
 * Its file has to be the one its meta describes (a half-written or hand-edited one isn't reused).
 */
export async function reusableDB(dir: string, key: { oracle: string; printings?: string; compiler: string }): Promise<CardDBMeta | null> {
  const metaPath = join(dir, 'cards.meta.json');
  const dbPath = join(dir, 'cards.json.gz');
  if (!existsSync(metaPath) || !existsSync(dbPath)) return null;
  let meta: CardDBMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as CardDBMeta;
  } catch {
    return null;
  }
  if (meta.sourceUpdatedAt !== key.oracle || meta.printingsUpdatedAt !== key.printings || meta.compiler !== key.compiler) return null;
  if (createHash('sha256').update(await readFile(dbPath)).digest('hex') !== meta.sha256) return null;
  return meta;
}

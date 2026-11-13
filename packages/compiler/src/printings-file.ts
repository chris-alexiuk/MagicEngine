import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { collectAltNames, type AltNameTable } from './printings.js';
import type { ScryfallCard } from './scryfall.js';

/**
 * Reads a Scryfall bulk file card by card without holding it in memory — the all-printings file is several hundred
 * megabytes. Both of Scryfall's formats put one card on a line: JSON Lines, or a JSON array with a card (and a
 * trailing comma) per line; either may be gzipped. `want`, if given, is tested against the raw line first, so only the
 * few cards of interest are parsed.
 */
export async function eachCard(path: string, visit: (card: ScryfallCard) => void, want?: (line: string) => boolean): Promise<number> {
  const fh = await open(path, 'r');
  const magic = Buffer.alloc(2);
  await fh.read(magic, 0, 2, 0);
  await fh.close();
  const gz = magic[0] === 0x1f && magic[1] === 0x8b;
  const input = gz ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  let seen = 0;
  for await (const raw of createInterface({ input, crlfDelay: Infinity })) {
    let line = raw.trim();
    if (line.endsWith(',')) line = line.slice(0, -1);
    if (!line.startsWith('{')) continue;
    seen++;
    if (want && !want(line)) continue;
    visit(JSON.parse(line) as ScryfallCard);
  }
  return seen;
}

/** Reads the alternate names out of an all-printings file (see eachCard). */
export async function readAltNames(path: string, into: AltNameTable = new Map()): Promise<{ table: AltNameTable; printings: number }> {
  const printings = await eachCard(path, (card) => collectAltNames([card], into), (line) => line.includes('"flavor_name"') || line.includes('"printed_name"'));
  return { table: into, printings };
}

#!/usr/bin/env node
/**
 * Builds a bundle of card images for hosts that can't load them from Scryfall's CDN.
 *
 *   node tools/art/build.mjs --pool cards.json.gz --out dir [options]
 *
 * The most-played cards (by EDHREC rank) are downloaded from the CDN, re-encoded as WebP — the first `--sharp` of them
 * at `--large-width`, the rest at `--small-width` — and concatenated into pack files of about equal size, with a
 * manifest saying where each image is. It stops when `--budget-mb` is reached. The whole scan is always kept: nothing
 * is cropped, so the artist and copyright line stay on every card.
 *
 *   --budget-mb 236      total size of the packs
 *   --max-packs 470      how many pack files at most (the host limits the number of files)
 *   --sharp 2500         how many of the most-played cards get the large size
 *   --large-width 488    --large-quality 80
 *   --small-width 300    --small-quality 72
 *   --extra file         card names (one per line) that are always included, at the large size
 *   --limit N            stop after N cards (trial runs)
 *   --ext wasm           extension of the pack files (a host may serve only some)
 *   --fake               draw placeholder images instead of downloading (for testing the bundle offline)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const POOL = opt('pool');
const OUT = opt('out');
if (!POOL || !OUT) {
  console.error('usage: build.mjs --pool cards.json.gz --out dir [--budget-mb 236] [--sharp 2500] …');
  process.exit(2);
}
const BUDGET = Number(opt('budget-mb', '236')) * 1e6;
const MAX_PACKS = Number(opt('max-packs', '470'));
const SHARP = Number(opt('sharp', '2500'));
const LARGE = { width: Number(opt('large-width', '488')), quality: Number(opt('large-quality', '80')) };
const SMALL = { width: Number(opt('small-width', '300')), quality: Number(opt('small-quality', '72')) };
const LIMIT = Number(opt('limit', '0')) || Infinity;
const EXT = opt('ext', 'wasm');
const FAKE = flag('fake');
const CDN = 'https://cards.scryfall.io/large/';
const HEADERS = { 'User-Agent': 'MagicEngine/0.1 (card art bundle)', Accept: 'image/*' };

/** "front/1/6/1698d962-….jpg?1700000000" → "f1698d962-…": what the app looks an image up by. */
export const keyOf = (img) => {
  const m = /^(front|back)\/[^/]+\/[^/]+\/([0-9a-f-]+)\.[a-z]+/.exec(img);
  return m ? m[1][0] + m[2] : null;
};

const raw = await readFile(POOL);
const db = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8'));
const extra = new Set(opt('extra') ? (await readFile(opt('extra'), 'utf8')).split('\n').map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith('#')) : []);
const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);
const forced = (c) => extra.has(c.name.toLowerCase()) || BASICS.has(c.name.toLowerCase());

// Most played first; the cards asked for by name and the basic lands before anything.
const cards = db.cards
  .filter((c) => c.faces.some((f) => f.img))
  .sort((a, b) => Number(forced(b)) - Number(forced(a)) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name))
  .slice(0, LIMIT);

/** The images of one card: each face's own, and — for the large tier — the printings it has other names on. */
function imagesOf(card, large) {
  const out = [];
  const add = (img) => {
    const key = img && keyOf(img);
    if (key && !out.some((x) => x.key === key)) out.push({ key, img });
  };
  for (const f of card.faces) add(f.img);
  if (large) for (const a of card.aka ?? []) (add(a.img), add(a.backImg));
  return out;
}

async function download(img) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(CDN + img, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 4) {
        console.warn(`  failed ${img}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
    }
  }
}

/** A stand-in scan for offline tests: the card's name on its colour. */
function fake(card) {
  const tint = { W: '#e9e2c8', U: '#2f6fb0', B: '#3a3340', R: '#c0452d', G: '#2f7d4f' }[card.colorIdentity?.[0]] ?? '#8a8f98';
  const name = card.name.replace(/[<&>]/g, '').slice(0, 26);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="936"><rect width="672" height="936" rx="30" fill="#15171c"/><rect x="28" y="28" width="616" height="880" rx="14" fill="${tint}"/><rect x="52" y="110" width="568" height="420" fill="#0006"/><text x="56" y="88" font-family="sans-serif" font-size="38" font-weight="700" fill="#111">${name}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function encode(source, { width, quality }) {
  return sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
}

/** Runs `work` over `items`, `n` at a time, keeping their order in the result. */
async function pool(items, n, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  }));
  return out;
}

const started = Date.now();
const done = []; // { key, bytes, width, card }
let total = 0;
let missing = 0;
const CHUNK = 96;
for (let at = 0; at < cards.length && total < BUDGET; at += CHUNK) {
  const jobs = cards.slice(at, at + CHUNK).flatMap((card, i) => {
    const large = at + i < SHARP || forced(card);
    return imagesOf(card, large).map((image) => ({ ...image, card, tier: large ? LARGE : SMALL }));
  });
  const encoded = await pool(jobs, 12, async (job) => {
    const source = FAKE ? await fake(job.card) : await download(job.img);
    if (!source) return null;
    try {
      return { key: job.key, card: job.card, width: job.tier.width, bytes: await encode(source, job.tier) };
    } catch (err) {
      console.warn(`  unreadable ${job.img}: ${err.message}`);
      return null;
    }
  });
  for (const e of encoded) {
    if (!e) {
      missing++;
      continue;
    }
    if (total + e.bytes.length > BUDGET) {
      total = BUDGET;
      break;
    }
    done.push(e);
    total += e.bytes.length;
  }
  if ((at / CHUNK) % 10 === 0) console.log(`  ${Math.min(at + CHUNK, cards.length)} cards, ${done.length} images, ${(done.reduce((n, e) => n + e.bytes.length, 0) / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
const bytes = done.reduce((n, e) => n + e.bytes.length, 0);

// Packs: cards of one colour identity together, most played first — a deck's cards then sit in fewer packs, which
// matters where the host can't serve part of a file and a pack is fetched whole.
const bucketOf = (card) => (card.colorIdentity ?? []).join('') || 'C';
const order = new Map(cards.map((c, i) => [c, i]));
const buckets = new Map();
for (const e of done) {
  const b = bucketOf(e.card);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(e);
}
const groups = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
const target = Math.max(128e3, Math.ceil(bytes / Math.max(1, MAX_PACKS - groups.length)));
const packs = [];
const images = {};
let current = null;
const close = () => {
  if (current?.parts.length) packs.push(current);
  current = null;
};
for (const [, list] of groups) {
  list.sort((a, b) => order.get(a.card) - order.get(b.card));
  for (const e of list) {
    if (current && current.size + e.bytes.length > target && current.parts.length) close();
    current ??= { parts: [], size: 0 };
    images[e.key] = [packs.length, current.size, e.bytes.length];
    current.parts.push(e.bytes);
    current.size += e.bytes.length;
  }
  // A small colour identity shares a pack with the next one rather than taking a file of its own.
  if (current && current.size > target * 0.6) close();
}
close();

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const names = [];
for (const [i, p] of packs.entries()) {
  const data = Buffer.concat(p.parts);
  // Named by content, so a pack that didn't change keeps its name (and its place in every cache) from build to build.
  const name = `p${String(i).padStart(3, '0')}-${createHash('sha256').update(data).digest('hex').slice(0, 8)}.${EXT}`;
  names.push(name);
  await writeFile(join(OUT, name), data);
}
const covered = new Set(done.map((e) => e.card));
const manifest = {
  v: 1,
  builtAt: new Date().toISOString(),
  format: 'webp',
  packs: names,
  sizes: packs.map((p) => p.size),
  cards: covered.size,
  images,
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest));
const lastRank = Math.max(0, ...[...covered].map((c) => c.rank ?? 0));
const report = [
  `cards: ${covered.size} (${done.length} images; ${missing} not available)`,
  `most-played rank reached: ${lastRank}`,
  `large (${LARGE.width}px): ${done.filter((e) => e.width === LARGE.width).length} images; small (${SMALL.width}px): ${done.filter((e) => e.width === SMALL.width).length}`,
  `bytes: ${(bytes / 1e6).toFixed(1)} MB in ${packs.length} packs (largest ${(Math.max(0, ...packs.map((p) => p.size)) / 1e3).toFixed(0)} KB)`,
  `manifest: ${(JSON.stringify(manifest).length / 1e3).toFixed(0)} KB`,
  `took ${((Date.now() - started) / 1000).toFixed(0)} s`,
].join('\n');
await writeFile(join(OUT, 'report.txt'), report + '\n');
console.log(report);

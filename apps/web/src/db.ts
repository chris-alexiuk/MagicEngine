import type { CardDB, CardDBMeta } from '@mtg/schema';
import { SCHEMA_VERSION } from '@mtg/schema';

/**
 * Loads the compiled card DB.
 *
 * The gzipped DB is kept in Cache Storage keyed by its sha256, so a reload costs
 * one tiny request for cards.meta.json. A new DB is downloaded only when the
 * hash changes; older copies are deleted. Works offline once cached.
 */

const CACHE_NAME = 'mtg-carddb-v1';

export interface LoadedDB {
  db: CardDB;
  meta: CardDBMeta;
  fromCache: boolean;
}

export class CardDBError extends Error {}

function hasCaches(): boolean {
  return typeof caches !== 'undefined';
}

async function fetchMeta(metaUrl: string): Promise<CardDBMeta> {
  try {
    const res = await fetch(metaUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const meta = (await res.json()) as CardDBMeta;
    if (hasCaches()) await (await caches.open(CACHE_NAME)).put(metaUrl, new Response(JSON.stringify(meta)));
    return meta;
  } catch (err) {
    // Offline or server down: fall back to the last meta we saw.
    const cached = hasCaches() ? await (await caches.open(CACHE_NAME)).match(metaUrl) : undefined;
    if (cached) return (await cached.json()) as CardDBMeta;
    throw new CardDBError(`Couldn't load ${metaUrl} (${String(err)}).`);
  }
}

async function decode(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  // Some hosts transparently un-gzip .gz files; only decompress real gzip data.
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

export async function loadCardDB(base: string): Promise<LoadedDB> {
  const metaUrl = new URL('cards.meta.json', new URL(base, location.href)).href;
  const meta = await fetchMeta(metaUrl);
  // Hosts that serve only certain extensions can carry the same gzip bytes under another name.
  const dbUrl = new URL(meta.file ?? 'cards.json.gz', new URL(base, location.href)).href;
  const key = `${dbUrl}?sha=${meta.sha256}`;

  let bytes: ArrayBuffer | null = null;
  let fromCache = false;
  const cache = hasCaches() ? await caches.open(CACHE_NAME) : null;

  const hit = cache ? await cache.match(key) : undefined;
  if (hit) {
    bytes = await hit.arrayBuffer();
    fromCache = true;
  } else {
    const res = await fetch(dbUrl, { cache: 'no-cache' });
    if (!res.ok) throw new CardDBError(`Couldn't download ${dbUrl} (HTTP ${res.status}).`);
    bytes = await res.arrayBuffer();
    if (cache) {
      await cache.put(key, new Response(bytes.slice(0)));
      for (const req of await cache.keys()) {
        if (req.url !== key && req.url !== metaUrl) await cache.delete(req);
      }
    }
  }

  const db = JSON.parse(await decode(bytes)) as CardDB;
  if (db.schema !== SCHEMA_VERSION) {
    throw new CardDBError(`Card data uses schema ${db.schema}, but this app expects ${SCHEMA_VERSION}. Rebuild the card DB.`);
  }
  return { db, meta, fromCache };
}

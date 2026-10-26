/*
 * Card image cache.
 *
 * Intercepts requests to Scryfall's image CDN, keeps responses in Cache Storage,
 * and evicts the least recently viewed images once the byte budget is exceeded.
 * An IndexedDB index tracks size, last access and pinned state per URL, plus the
 * running total, so eviction never has to scan the whole cache.
 *
 * Only CORS responses are cached: opaque responses are padded by browsers when
 * counting quota and would make the budget meaningless.
 */
const IMAGE_HOST = 'cards.scryfall.io';
const CACHE_NAME = 'mtg-images-v1';
const DB_NAME = 'mtg-image-index';
const DEFAULT_BUDGET = 250 * 1024 * 1024;
const TOUCH_INTERVAL_MS = 60 * 1000;
const EVICT_TO = 0.9; // evict down to 90% of the budget to avoid evicting on every insert

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.hostname !== IMAGE_HOST) return;
  event.respondWith(handleImage(event, req));
});

async function handleImage(event, req) {
  const key = req.url;
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(key);
  if (hit) {
    event.waitUntil(touch(key).catch(() => {}));
    return hit;
  }

  let res;
  try {
    res = await fetch(key, { mode: 'cors', credentials: 'omit' });
  } catch {
    // CORS refused or offline: let the browser try the original request, uncached.
    return fetch(req);
  }
  if (!res.ok) return res;

  const forCache = res.clone();
  event.waitUntil(
    (async () => {
      const blob = await forCache.blob();
      const type = forCache.headers.get('Content-Type') || 'image/jpeg';
      await cache.put(key, new Response(blob, { status: 200, headers: { 'Content-Type': type } }));
      await record(key, blob.size);
      await evict();
    })().catch((err) => console.warn('image cache write failed', err)),
  );
  return res;
}

// ---------------------------------------------------------------------------
// IndexedDB index
// ---------------------------------------------------------------------------

let dbPromise;
function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const entries = db.createObjectStore('entries', { keyPath: 'url' });
      entries.createIndex('lastAccess', 'lastAccess');
      db.createObjectStore('meta');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

const req2p = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

async function getMeta(key, fallback) {
  const db = await openDB();
  const v = await req2p(db.transaction('meta').objectStore('meta').get(key));
  return v === undefined ? fallback : v;
}

async function record(url, size) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'meta'], 'readwrite');
  const entries = tx.objectStore('entries');
  const meta = tx.objectStore('meta');
  const prev = await req2p(entries.get(url));
  const total = (await req2p(meta.get('total'))) || 0;
  entries.put({ url, size, lastAccess: Date.now(), pinned: prev ? prev.pinned : false });
  meta.put(total + size - (prev ? prev.size : 0), 'total');
  await done(tx);
}

async function touch(url) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  const entry = await req2p(store.get(url));
  if (entry && Date.now() - entry.lastAccess > TOUCH_INTERVAL_MS) {
    entry.lastAccess = Date.now();
    store.put(entry);
  }
  await done(tx);
}

async function evict() {
  const budget = await getMeta('budget', DEFAULT_BUDGET);
  let total = await getMeta('total', 0);
  if (total <= budget) return;

  const db = await openDB();
  const tx = db.transaction(['entries', 'meta'], 'readwrite');
  const entries = tx.objectStore('entries');
  const removed = [];
  await new Promise((resolve, reject) => {
    const cursorReq = entries.index('lastAccess').openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || total <= budget * EVICT_TO) return resolve();
      const entry = cursor.value;
      if (!entry.pinned) {
        total -= entry.size;
        removed.push(entry.url);
        cursor.delete();
      }
      cursor.continue();
    };
  });
  tx.objectStore('meta').put(Math.max(0, total), 'total');
  await done(tx);

  const cache = await caches.open(CACHE_NAME);
  await Promise.all(removed.map((url) => cache.delete(url)));
}

async function stats() {
  const db = await openDB();
  const tx = db.transaction(['entries', 'meta']);
  const all = await req2p(tx.objectStore('entries').getAll());
  const budget = (await req2p(tx.objectStore('meta').get('budget'))) ?? DEFAULT_BUDGET;
  const cached = all.filter((e) => e.size > 0);
  return {
    count: cached.length,
    bytes: cached.reduce((n, e) => n + e.size, 0),
    budget,
    pinned: all.filter((e) => e.pinned).length,
  };
}

async function clearUnpinned() {
  const db = await openDB();
  const tx = db.transaction(['entries', 'meta'], 'readwrite');
  const entries = tx.objectStore('entries');
  const all = await req2p(entries.getAll());
  const removed = [];
  let total = 0;
  for (const e of all) {
    if (e.pinned) total += e.size;
    else {
      removed.push(e.url);
      entries.delete(e.url);
    }
  }
  tx.objectStore('meta').put(total, 'total');
  await done(tx);
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(removed.map((url) => cache.delete(url)));
}

async function setPinned(urls, pinned) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  for (const url of urls) {
    const entry = await req2p(store.get(url));
    if (entry) store.put({ ...entry, pinned });
    // Pinning a not-yet-cached image leaves a size-0 placeholder that keeps the pin.
    else if (pinned) store.put({ url, size: 0, lastAccess: Date.now(), pinned: true });
  }
  await done(tx);
}

async function setBudget(bytes) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(Math.max(10 * 1024 * 1024, Number(bytes) || DEFAULT_BUDGET), 'budget');
  await done(tx);
  await evict();
}

self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0];
  const msg = event.data || {};
  event.waitUntil(
    (async () => {
      let reply;
      try {
        if (msg.type === 'setBudget') await setBudget(msg.bytes);
        else if (msg.type === 'clear') await clearUnpinned();
        else if (msg.type === 'pin') await setPinned(msg.urls || [], true);
        else if (msg.type === 'unpin') await setPinned(msg.urls || [], false);
        else if (msg.type !== 'stats') throw new Error(`unknown message ${msg.type}`);
        reply = await stats();
      } catch (err) {
        reply = { error: String(err) };
      }
      if (port) port.postMessage(reply);
    })(),
  );
});

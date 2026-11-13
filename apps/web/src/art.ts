import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Card art shipped with the app, for hosts that can't load images from Scryfall's CDN.
 *
 * `art/manifest.json` (built by tools/art) says which images are bundled and where: each is a run of bytes in one of
 * a few hundred pack files. An image is fetched when a card showing it first comes into view — just its own bytes
 * where the host can serve part of a file, otherwise its whole pack (which then serves its other images for free).
 * With no manifest beside the app, nothing here does anything and cards load from the CDN as before.
 */

interface Manifest {
  v: number;
  packs: string[];
  /** image key → [pack, offset, length] */
  images: Record<string, [number, number, number]>;
  cards?: number;
}

let manifest: Manifest | null = null;
let base = '';
const listeners = new Set<() => void>();
/** Whether the host answers a request for part of a file (unknown until the first image is fetched). */
let ranges: boolean | undefined;
let probing: Promise<void> | null = null;
const packs = new Map<number, Promise<Blob>>();
const urls = new Map<string, Promise<string | null>>();
const ready = new Map<string, string>();

/** "front/1/6/1698d962-….jpg?1700000000" → "f1698d962-…" (the manifest's key). */
export function artKey(img: string): string | null {
  const m = /^(front|back)\/[^/]+\/[^/]+\/([0-9a-f-]+)\.[a-z]+/.exec(img);
  return m ? m[1]![0]! + m[2]! : null;
}

/** Looks for a bundle beside the app. Resolves true if there is one. */
export async function loadArtBundle(baseUrl: string): Promise<boolean> {
  try {
    const dir = new URL('art/', new URL(baseUrl, location.href)).href;
    const res = await fetch(`${dir}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    const m = (await res.json()) as Manifest;
    if (m.v !== 1 || !Array.isArray(m.packs) || !m.images) return false;
    manifest = m;
    base = dir;
    listeners.forEach((l) => l());
    return true;
  } catch {
    return false;
  }
}

/** For tests: a bundle given directly. */
export function setArtBundle(m: Manifest | null, dir = ''): void {
  manifest = m;
  base = dir;
  ranges = undefined;
  probing = null;
  packs.clear();
  urls.clear();
  ready.clear();
  listeners.forEach((l) => l());
}

export function hasArt(img: string | undefined): boolean {
  const key = img ? artKey(img) : null;
  return Boolean(key && manifest?.images[key]);
}

/** How many cards the bundle covers, or null without one. */
export function artBundleSize(): number | null {
  return manifest ? (manifest.cards ?? Object.keys(manifest.images).length) : null;
}

function wholePack(pack: number): Promise<Blob> {
  let p = packs.get(pack);
  if (!p) {
    p = fetch(base + manifest!.packs[pack]!).then((res) => {
      if (!res.ok) throw new Error(`pack ${pack}: HTTP ${res.status}`);
      return res.blob();
    });
    packs.set(pack, p);
    p.catch(() => packs.delete(pack));
  }
  return p;
}

async function imageBytes(pack: number, offset: number, length: number): Promise<Blob> {
  const cut = async () => (await wholePack(pack)).slice(offset, offset + length, 'image/webp');
  if (ranges === false || packs.has(pack)) return cut();
  // The first image settles whether part of a file can be asked for; the ones requested meanwhile wait for it.
  if (ranges === undefined && probing) {
    await probing;
    return imageBytes(pack, offset, length);
  }
  const ask = (async (): Promise<Blob | null> => {
    try {
      const res = await fetch(base + manifest!.packs[pack]!, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status === 206) {
        const part = await res.blob();
        if (part.size === length) {
          ranges = true;
          return part.slice(0, length, 'image/webp');
        }
      } else if (res.ok) {
        // The whole file came back: keep it, and don't ask for parts again.
        ranges = false;
        const whole = res.blob();
        packs.set(pack, whole);
        return (await whole).slice(offset, offset + length, 'image/webp');
      }
    } catch {
      /* fall through to the whole pack */
    }
    ranges ??= false;
    return null;
  })();
  if (ranges === undefined) probing = ask.then(() => undefined);
  return (await ask) ?? cut();
}

/** An object URL for a bundled image (kept for the life of the page), or null if it isn't bundled or can't be read. */
export function artUrl(img: string): Promise<string | null> {
  const key = artKey(img);
  const where = key ? manifest?.images[key] : undefined;
  if (!key || !where) return Promise.resolve(null);
  let p = urls.get(key);
  if (!p) {
    p = imageBytes(where[0], where[1], where[2])
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        ready.set(key, url);
        return url;
      })
      .catch(() => {
        urls.delete(key);
        return null;
      });
    urls.set(key, p);
  }
  return p;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True when a bundle is loaded (re-renders when one arrives). */
export function useArtBundle(): boolean {
  return useSyncExternalStore(subscribe, () => manifest !== null, () => false);
}

/**
 * The bundled image for a card face: `bundled` says whether there is one at all, `url` is set once it has been read.
 * Nothing is fetched until `wanted` (the card is on screen, or about to be).
 */
export function useBundledArt(img: string | undefined, wanted: boolean): { bundled: boolean; url: string | null; failed: boolean } {
  const present = useArtBundle();
  const key = img ? artKey(img) : null;
  const bundled = Boolean(present && key && manifest?.images[key]);
  const [state, setState] = useState<{ key: string | null; url: string | null; failed: boolean }>(() => ({ key, url: (key && ready.get(key)) ?? null, failed: false }));
  useEffect(() => {
    if (!bundled || !img || !key) {
      setState({ key, url: null, failed: false });
      return;
    }
    const have = ready.get(key);
    if (have) {
      setState({ key, url: have, failed: false });
      return;
    }
    setState({ key, url: null, failed: false });
    if (!wanted) return;
    let live = true;
    void artUrl(img).then((url) => {
      if (live) setState({ key, url, failed: url === null });
    });
    return () => {
      live = false;
    };
  }, [bundled, img, key, wanted]);
  return { bundled, url: state.key === key ? state.url : null, failed: state.key === key && state.failed };
}

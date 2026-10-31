import type { CardDef } from '@mtg/schema';
import { imageUrl } from '@mtg/schema';
import { pinImages, unpinImages } from '../imageCache';
import type { Deck } from './model';

/**
 * Saved decks live in localStorage (they're small: names and counts). Every access is wrapped: storage can be
 * missing, full, or blocked (private windows), and the app must keep working without it.
 */

const KEY = 'mtg-decks-v1';
const PINNED_KEY = 'mtg-pinned-images-v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadDecks(): Deck[] {
  const decks = read<unknown>(KEY, []);
  if (!Array.isArray(decks)) return [];
  return decks.filter((d): d is Deck => Boolean(d && typeof d === 'object' && typeof (d as Deck).id === 'string' && Array.isArray((d as Deck).main)));
}

/** Saves all decks; false if the browser wouldn't store them. */
export function saveDecks(decks: Deck[]): boolean {
  return write(KEY, decks);
}

/** The image URLs a card shows in play: every face, in both sizes the app requests. */
export function cardImageUrls(card: CardDef): string[] {
  const paths = [...new Set(card.faces.map((f) => f.img).filter((p): p is string => Boolean(p)))];
  return paths.flatMap((p) => [imageUrl(p, 'small'), imageUrl(p, 'normal')]);
}

/**
 * Keeps the image cache's pins in step with the saved decks: images of cards in any saved deck are pinned (never
 * evicted); images no saved deck uses any more are unpinned. Nothing is downloaded here — a pin on an image that
 * isn't cached yet just keeps it once it's viewed.
 */
export async function syncPins(decks: Deck[], lookup: (name: string) => CardDef | undefined): Promise<void> {
  const want = new Set<string>();
  for (const d of decks) {
    for (const name of [...d.commanders, ...d.main.map((c) => c.name)]) {
      const card = lookup(name);
      if (card) for (const u of cardImageUrls(card)) want.add(u);
    }
  }
  const had = new Set(read<string[]>(PINNED_KEY, []));
  const add = [...want].filter((u) => !had.has(u));
  const drop = [...had].filter((u) => !want.has(u));
  try {
    if (add.length) await pinImages(add);
    if (drop.length) await unpinImages(drop);
    write(PINNED_KEY, [...want]);
  } catch (err) {
    console.warn('Couldn’t update pinned images:', err);
  }
}

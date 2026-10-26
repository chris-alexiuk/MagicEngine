/**
 * Page-side controls for the card image cache that lives in public/sw.js.
 * Images load on demand from Scryfall's CDN; the service worker keeps them
 * within a byte budget and evicts the least recently viewed first.
 */

export interface ImageCacheStats {
  count: number;
  bytes: number;
  budget: number;
  pinned: number;
}

export const BUDGET_CHOICES = [100, 250, 500, 1024].map((mb) => mb * 1024 * 1024);

export function imageCacheSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext;
}

export async function registerImageCache(base: string): Promise<void> {
  if (!imageCacheSupported()) return;
  try {
    await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  } catch (err) {
    console.warn('Image cache unavailable:', err);
  }
}

async function ask<T>(message: Record<string, unknown>): Promise<T | null> {
  if (!imageCacheSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller ?? reg.active;
  if (!worker) return null;
  return new Promise<T | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 5000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && !e.data.error ? (e.data as T) : null);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export const imageCacheStats = () => ask<ImageCacheStats>({ type: 'stats' });
export const setImageBudget = (bytes: number) => ask<ImageCacheStats>({ type: 'setBudget', bytes });
export const clearImageCache = () => ask<ImageCacheStats>({ type: 'clear' });
/** Pinned images (e.g. cards in saved decks) are never evicted. Used by the deck editor. */
export const pinImages = (urls: string[]) => ask<ImageCacheStats>({ type: 'pin', urls });
export const unpinImages = (urls: string[]) => ask<ImageCacheStats>({ type: 'unpin', urls });

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')} GB`;
}

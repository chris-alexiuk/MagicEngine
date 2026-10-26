import type { GameState } from './types.js';

/**
 * Deterministic randomness: mulberry32, with its 32-bit state stored in the
 * game state. Same seed + same actions ⇒ same game, on every client and the server.
 */
export function nextRandom(g: GameState): number {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Fisher–Yates, in place. */
export function shuffleInPlace<T>(g: GameState, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(g) * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

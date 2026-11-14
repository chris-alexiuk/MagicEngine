/**
 * What the engine remembers about card definitions from one game to the next, by their ids ("has an ability that
 * works from the graveyard"): worked out once, since a definition doesn't change. A host that puts another definition
 * under an id it has used — a newer card database, a test's own cards — says so with `forgetCards()`; so do the card
 * checks before each card, so that what one card's play worked out is no part of the next one's.
 */
const emptied: (() => void)[] = [];

/** Registers a cache: `empty` is called by `forgetCards()`. */
export function remembered(empty: () => void): void {
  emptied.push(empty);
}

export function forgetCards(): void {
  for (const empty of emptied) empty();
}

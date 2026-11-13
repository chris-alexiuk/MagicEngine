/**
 * Card sizes on the battlefield, chosen like a digital client's: the largest card width at which each seat's lanes fit
 * the room they have, with tapped cards given their sideways width so they never overlap into slivers.
 */

export const RATIO = 88 / 63;

export interface Item {
  tapped: boolean;
  /** Drawn smaller than a creature (lands are 85%, like a client's battlefield). */
  scale?: number;
  /** How many cards are stacked in it (a pile of identical lands shows a sliver of each, up to four). */
  stack?: number;
  /** Extra room before it, in pixels (the first of a group that's set apart from the one before). */
  pad?: number;
}

/** One lane: its items, laid out in rows (wrapping when they don't fit on one). */
export type Lane = Item[];

export interface FitOptions {
  /** Room the lanes have. */
  width: number;
  height: number;
  gap?: number;
  /** Height under each row for its chips (power/toughness on images, counters, damage). */
  chips?: number;
  min?: number;
  max?: number;
  /** Space between lanes. */
  laneGap?: number;
  /** An empty lane still keeps this much height (a hint where creatures go). */
  emptyLane?: number;
}

/** How wide an item is at card width w. */
export function itemWidth(it: Item, w: number): number {
  const s = it.scale ?? 1;
  const base = (it.tapped ? w * RATIO : w) * s;
  const extra = Math.min(Math.max((it.stack ?? 1) - 1, 0), 3) * base * 0.18;
  return base + extra + (it.pad ?? 0);
}

/** Rows a lane needs at card width w, filling each row before starting the next. */
export function rowsFor(lane: Lane, w: number, width: number, gap: number): number {
  if (!lane.length) return 0;
  let rows = 1;
  let x = 0;
  for (const it of lane) {
    const iw = itemWidth(it, w);
    if (x > 0 && x + gap + iw > width) {
      rows++;
      x = iw;
    } else x += (x > 0 ? gap : 0) + iw;
  }
  return rows;
}

/** The card width at which every lane fits (or the minimum, when even that doesn't). */
export function fitCardWidth(lanes: Lane[], o: FitOptions): number {
  const gap = o.gap ?? 8;
  const chips = o.chips ?? 14;
  const laneGap = o.laneGap ?? 10;
  const min = o.min ?? 40;
  const max = o.max ?? 140;
  const empty = o.emptyLane ?? 20;
  if (o.width <= 0 || o.height <= 0) return min;
  for (let w = max; w > min; w -= 2) {
    const h = w * RATIO;
    let total = 0;
    let fits = true;
    lanes.forEach((lane, i) => {
      const rows = rowsFor(lane, w, o.width, gap);
      // Wider than the seat even alone (a long stack): it doesn't fit at this size.
      if (lane.some((it) => itemWidth(it, w) > o.width)) fits = false;
      const tall = Math.max(...lane.map((it) => it.scale ?? 1), 0);
      total += rows ? rows * (h * tall + chips) + (rows - 1) * gap : empty;
      if (i > 0) total += laneGap;
    });
    if (fits && total <= o.height) return w;
  }
  return min;
}

/**
 * The card width at which every group fits side by side in one row, at most one card high (0 when even the minimum
 * doesn't). Groups are kept apart by `groupGap`.
 */
export function fitRow(groups: Lane[], o: FitOptions & { groupGap?: number }): number {
  const gap = o.gap ?? 8;
  const chips = o.chips ?? 14;
  const groupGap = o.groupGap ?? 24;
  const min = o.min ?? 40;
  const max = o.max ?? 140;
  const filled = groups.filter((g) => g.length);
  if (o.width <= 0 || o.height <= 0) return 0;
  const tall = Math.max(...filled.flat().map((it) => it.scale ?? 1), 0);
  for (let w = max; w >= min; w -= 2) {
    if (w * RATIO * tall + chips > o.height) continue;
    let total = Math.max(filled.length - 1, 0) * groupGap;
    for (const g of filled) total += g.reduce((n, it) => n + itemWidth(it, w), 0) + (g.length - 1) * gap;
    if (total <= o.width) return w;
  }
  return 0;
}

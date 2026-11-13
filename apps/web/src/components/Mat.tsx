import { imageUrl, type CardDef } from '@mtg/schema';
import { useEffect, useState, type CSSProperties } from 'react';
import { useBundledArt } from '../art';
import { useImagesBlocked } from './Card';

/**
 * A playmat: a commander's art under a scrim, over a wash of its colours. Each seat's cards lie on one at the table,
 * and a deck's page opens on its own.
 */

/** What a seat (or a deck) is dressed in: its commanders' colour identity, and the image its playmat is cut from. */
export interface SeatLook {
  colors: string[];
  /** The commander's scan (an image path), when there is a commander. */
  art?: string;
  /**
   * Whose art that is ("Illustrated by …"): shown on the mat, since the mat shows the art without the card's credit
   * line. The artist only: whose copyright the art is differs by printing (a crossover set's belongs to its licensor),
   * and the card itself, with its own credit line, is on the same screen.
   */
  credit?: string;
}

/** A seat's or deck's look from its commanders (the first one's art, all their colours). */
export function lookOf(commanders: readonly (CardDef | undefined)[]): SeatLook {
  const defs = commanders.filter((c): c is CardDef => Boolean(c));
  const colors = 'WUBRG'.split('').filter((c) => defs.some((d) => (d.colorIdentity as string[]).includes(c)));
  const face = defs[0]?.faces[0];
  if (!face?.img) return { colors };
  return { colors, art: face.img, credit: face.artist ? `Illustrated by ${face.artist}` : `Art from ${defs[0]!.name}` };
}

const MANA_HEX: Record<string, string> = { W: '#e6dcae', U: '#3a8fdc', B: '#8d78a3', R: '#dc4f34', G: '#35a060' };
const NO_COLOR = '#959ba3';

/** A ring in the seat's colours, around its life total. */
export function ringOf(colors: string[]): string {
  const list = colors.map((c) => MANA_HEX[c] ?? NO_COLOR);
  if (list.length <= 1) return list[0] ?? NO_COLOR;
  const step = 100 / list.length;
  return `conic-gradient(from -90deg, ${list.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ')})`;
}

/**
 * The art is shown as it is — scaled, never blurred or recoloured (the image rules of the card data's source); a
 * scrim in the stylesheet lies over it. From a bundled scan the art box is found by where a card frame puts it; from
 * the CDN the art comes cropped. Either way the mat names the artist, as the card's own credit line isn't in view.
 */
export function SeatMat({ look }: { look: SeatLook }) {
  const blocked = useImagesBlocked();
  const bundle = useBundledArt(look.art, true);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [look.art]);
  const fromScan = bundle.bundled && !bundle.failed;
  const src = failed || !look.art ? null : fromScan ? bundle.url : blocked ? null : imageUrl(look.art, 'art_crop');
  const a = MANA_HEX[look.colors[0] ?? ''] ?? NO_COLOR;
  const b = MANA_HEX[look.colors[look.colors.length - 1] ?? ''] ?? a;
  return (
    <div className="mat" style={{ ['--mat-a' as string]: a, ['--mat-b' as string]: b } as CSSProperties}>
      {src && <img className={fromScan ? 'mat-art from-scan' : 'mat-art'} src={src} alt="" draggable={false} onError={() => setFailed(true)} />}
      {src && look.credit && <span className="mat-credit">{look.credit}</span>}
    </div>
  );
}

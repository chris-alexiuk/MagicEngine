import { tokenArtFinder, type CardDef, type FaceDef } from '@mtg/schema';

/**
 * What a card is drawn with when that isn't its own default scan: the printing a deck asked for by another name
 * ("Seymour Guado" for Kinnan, Bonder Prodigy), and the printed token for a token the engine described itself.
 * Rules never look here — a card's name and text are its own whatever it is drawn with.
 */

/** Another printing's scan to draw instead of the card's own. */
export interface Printing {
  img?: string;
  backImg?: string;
  /** Who illustrated it. */
  artist?: string;
}

let findToken: ((face: FaceDef) => string | undefined) | null = null;
let withArt = new WeakMap<CardDef, CardDef>();

/** The printed tokens to draw described tokens with (the card DB's). */
export function setTokenArt(tokens: readonly CardDef[]): void {
  findToken = tokenArtFinder(tokens);
  withArt = new WeakMap();
}

/** A token's definition with its printed token's image, where its faces have none (the card data links most already). */
export function tokenWithArt(card: CardDef): CardDef {
  if (card.layout !== 'token' || !findToken || card.faces.every((f) => f.img)) return card;
  let out = withArt.get(card);
  if (!out) {
    const find = findToken;
    const faces = card.faces.map((f) => {
      const img = f.img ?? find(f);
      return img ? { ...f, img } : f;
    });
    out = faces.some((f, i) => f !== card.faces[i]) ? { ...card, faces } : card;
    withArt.set(card, out);
  }
  return out;
}

const dressed = new Map<string, CardDef>();

/** A card's definition drawn with another printing. */
export function withPrinting(card: CardDef, p: Printing | undefined): CardDef {
  if (!p?.img) return card;
  const key = `${card.id}|${p.img}|${p.backImg ?? ''}|${p.artist ?? ''}`;
  let out = dressed.get(key);
  if (!out) {
    // The first face's image is the card's (split and adventure halves share it); a second face with an image of
    // its own is the back of a double-faced card.
    // The credit goes with the image: this printing's artist, or none where it isn't known (never the usual one's).
    const front = (f: CardDef['faces'][number]) => {
      const { artist: _, ...rest } = f;
      return { ...rest, img: p.img!, ...(p.artist ? { artist: p.artist } : {}) };
    };
    out = { ...card, faces: card.faces.map((f, i) => (i === 0 ? front(f) : f.img && p.backImg ? { ...f, img: p.backImg } : f)) };
    dressed.set(key, out);
  }
  return out;
}

/** The printings each seat's deck asked for, by card name: set when a game starts or resumes. */
let seatSkins: Record<string, Record<string, Printing>> = {};
export function setSeatSkins(skins: Record<string, Record<string, Printing>>): void {
  seatSkins = skins;
}
export function seatPrinting(owner: string, cardName: string): Printing | undefined {
  return seatSkins[owner]?.[cardName];
}

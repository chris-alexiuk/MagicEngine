import type { CardDef } from '@mtg/schema';
import type { GameObject } from '@mtg/engine';
import { CardImage } from '../components/bits';

/** The card definition and face an object shows (a copy shows what it copies; CR 707.2). */
export function shownCard(cards: Record<string, CardDef>, o: GameObject): { card: CardDef; face: number } | null {
  const key = o.copyOf?.card ?? o.card;
  const card = cards[key] ?? cards[o.card];
  if (!card) return null;
  return { card, face: o.copyOf?.face ?? o.face };
}

/**
 * A card at table size. The image comes from Scryfall's CDN through the image cache; while it loads, or if it can't,
 * the text proxy shows. Nothing is ever drawn over the card image, so the artist and copyright line stay visible.
 */
export function TableCard({ cards, o, sizes, title }: { cards: Record<string, CardDef>; o: GameObject; sizes: string; title?: string }) {
  const shown = shownCard(cards, o);
  return (
    <span className="tc-frame" title={title}>
      {shown ? <CardImage card={shown.card} faceIndex={shown.face} sizes={sizes} /> : <span className="card-back" />}
    </span>
  );
}

/** The back of a card (hidden hands and libraries). */
export function CardBack({ label }: { label?: string }) {
  return (
    <span className="tc-frame">
      <span className="card-back">{label}</span>
    </span>
  );
}

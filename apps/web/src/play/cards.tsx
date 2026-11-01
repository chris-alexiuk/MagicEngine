import type { CardDef } from '@mtg/schema';
import type { GameObject } from '@mtg/engine';
import { CardBackFace, CardView } from '../components/Card';

/** The card definition and face an object shows (a copy shows what it copies; CR 707.2). */
export function shownCard(cards: Record<string, CardDef>, o: GameObject): { card: CardDef; face: number } | null {
  const key = o.copyOf?.card ?? o.card;
  const card = cards[key] ?? cards[o.card];
  if (!card) return null;
  return { card, face: o.copyOf?.face ?? o.face };
}

/** A game object drawn as a card (its image, or its proxy). */
export function TableCard({ cards, o, sizes, title }: { cards: Record<string, CardDef>; o: GameObject; sizes: string; title?: string }) {
  const shown = shownCard(cards, o);
  return (
    <span className="tc-frame" title={title}>
      {shown ? <CardView card={shown.card} faceIndex={shown.face} sizes={sizes} /> : <CardBackFace />}
    </span>
  );
}

/** The back of a card (hidden hands and libraries). */
export function CardBack({ label }: { label?: string }) {
  return (
    <span className="tc-frame">
      <CardBackFace {...(label ? { label } : {})} />
    </span>
  );
}

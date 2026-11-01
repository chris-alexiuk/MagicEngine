import type { Automation, CardDef } from '@mtg/schema';
import { CardView } from './Card';

export { ManaCost, ManaSymbol, RulesText } from './mana';

// ---------------------------------------------------------------------------
// Engine coverage marker: shape carries the meaning, not just colour.
// ---------------------------------------------------------------------------

export const AUTOMATION_LABEL: Record<Automation, string> = {
  full: 'Automatic',
  partial: 'Partial',
  manual: 'Manual',
};

export const AUTOMATION_HINT: Record<Automation, string> = {
  full: 'The engine runs every line of this card.',
  partial: 'The engine runs some lines; you resolve the rest in play.',
  manual: 'You resolve this card’s rules text in play.',
};

export function AutomationMark({ level, size = 12 }: { level: Automation; size?: number }) {
  return (
    <svg className={`mark mark-${level}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {level === 'full' && <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" className="mark-fill" />}
      {level === 'partial' && <path d="M6 0.8 L6 11.2 L0.8 6 Z" className="mark-fill" />}
      <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" className="mark-outline" />
    </svg>
  );
}

/** A card image (or its proxy) filling its box. */
export function CardImage({ card, faceIndex = 0, sizes, eager = false }: { card: CardDef; faceIndex?: number; sizes: string; eager?: boolean }) {
  return <CardView card={card} faceIndex={faceIndex} sizes={sizes} eager={eager} />;
}

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

/** What a card's grade means in play — with a problem a test play found, when that is why it isn't automatic. */
export function automationHint(card: CardDef): string {
  if (!card.issues?.length) return AUTOMATION_HINT[card.automation];
  const unread = card.faces.some((f) => f.unparsed.length > 0 || (f.manualKeywords?.length ?? 0) > 0);
  return unread ? AUTOMATION_HINT[card.automation] : 'The engine reads every line, but a test play of this card went wrong. Check what it does as you play it.';
}

/** What went wrong when the card was played once in the sandbox (CardDef.issues), if anything did. */
export function TestPlayIssues({ card }: { card: CardDef }) {
  if (!card.issues?.length) return null;
  return (
    <ul className="test-issues">
      {card.issues.map((issue) => (
        <li key={issue}>In a test play: {issue.replace(/\.$/, '')}.</li>
      ))}
    </ul>
  );
}

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

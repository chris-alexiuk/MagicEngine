import type { Deck } from './model';

/**
 * Plain text with section headers, the format Moxfield, Archidekt and Arena all import:
 *
 *   Commander
 *   1 Kinnan, Bonder Prodigy
 *
 *   Deck
 *   1 Sol Ring
 */
export function deckToText(deck: Pick<Deck, 'commanders' | 'main' | 'sideboard'>): string {
  const sorted = [...deck.main].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  if (deck.commanders.length) out.push('Commander', ...deck.commanders.map((n) => `1 ${n}`), '');
  out.push('Deck', ...sorted.map((c) => `${c.count} ${c.name}`));
  if (deck.sideboard.length) out.push('', 'Sideboard', ...deck.sideboard.map((c) => `${c.count} ${c.name}`));
  return out.join('\n') + '\n';
}

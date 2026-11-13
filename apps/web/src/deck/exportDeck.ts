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
export function deckToText(deck: Pick<Deck, 'commanders' | 'main' | 'sideboard' | 'skins'>): string {
  const sorted = [...deck.main].sort((a, b) => a.name.localeCompare(b.name));
  // A card the deck plays as a printing with a name of its own keeps that printing: "(FCA) 55" after the card's name,
  // which every importer reads as that printing.
  const line = (n: number, name: string) => {
    const skin = deck.skins?.[name];
    return skin ? `${n} ${name} (${skin.set.toUpperCase()}) ${skin.number}` : `${n} ${name}`;
  };
  const out: string[] = [];
  if (deck.commanders.length) out.push('Commander', ...deck.commanders.map((n) => line(1, n)), '');
  out.push('Deck', ...sorted.map((c) => line(c.count, c.name)));
  if (deck.sideboard.length) out.push('', 'Sideboard', ...deck.sideboard.map((c) => line(c.count, c.name)));
  return out.join('\n') + '\n';
}

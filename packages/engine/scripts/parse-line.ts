/**
 * Compiles one card's text and prints the result, for grammar work:
 *   tsx scripts/parse-line.ts "Creature — Bear" "Oracle text…" [name]
 */
import { makeCard } from '../test/helpers.js';

const [typeLine = 'Instant', text = '', name = 'Test Card'] = process.argv.slice(2).filter((a) => a !== '--');
const card = makeCard({ name, type_line: typeLine, oracle_text: text.replace(/\\n/g, '\n'), mana_cost: process.env.MANA ?? '{1}', power: '2', toughness: '2' });
for (const f of card.faces) {
  console.log(JSON.stringify({ abilities: f.abilities, keywords: f.keywords, unparsed: f.unparsed, manualKeywords: f.manualKeywords }, null, 1));
}

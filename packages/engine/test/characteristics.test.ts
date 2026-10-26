import { describe, expect, it } from 'vitest';
import { hasProtectionFrom, protectionQualities } from '../src/characteristics.js';
import { give, makeCard, start } from './helpers.js';

describe('protection', () => {
  const knight = makeCard({ name: 'Knight', type_line: 'Creature — Knight', oracle_text: 'Protection from black and from red', power: '2', toughness: '2' });
  const dragonSlayer = makeCard({ name: 'Slayer', type_line: 'Creature — Human', oracle_text: 'Protection from Dragons', power: '1', toughness: '1' });
  const warded = makeCard({ name: 'Warded', type_line: 'Creature — Spirit', oracle_text: 'Protection from creatures', power: '1', toughness: '1' });
  const dragon = makeCard({ name: 'Dragon', type_line: 'Creature — Dragon', mana_cost: '{R}', oracle_text: 'Flying', power: '4', toughness: '4' });
  const g = start({ extra: [knight, dragonSlayer, warded, dragon] });
  const obj = (name: string) => g.objects[give(g, 'alice', name, 'battlefield')]!;

  it('CR 702.16g: "protection from A and from B" is two protection abilities', () => {
    expect(protectionQualities(g, obj('Knight'))).toEqual(['black', 'red']);
  });

  it('CR 702.16a: qualities can be colors, card types or creature types', () => {
    const red = obj('Dragon');
    const bears = obj('Grizzly Bears');
    expect(hasProtectionFrom(g, obj('Knight'), red)).toBe(true);
    expect(hasProtectionFrom(g, obj('Knight'), bears)).toBe(false);
    expect(hasProtectionFrom(g, obj('Slayer'), red)).toBe(true);
    expect(hasProtectionFrom(g, obj('Warded'), bears)).toBe(true);
  });
});

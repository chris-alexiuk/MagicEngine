import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, legalActions, power, toughness, type GameState } from '../src/index.js';
import { manaAbilities } from '../src/characteristics.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Frog Curse', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.' }),
  makeCard({ name: 'Angel', type_line: 'Creature — Angel', mana_cost: '{0}', colors: ['W'], power: '4', toughness: '4', oracle_text: 'Flying\nWhenever this creature attacks, you gain 3 life.\n{T}: You gain 1 life.' }),
  makeCard({ name: 'Mystic', type_line: 'Creature — Elf', mana_cost: '{0}', colors: ['G'], power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Hush', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, target creature loses all abilities and has base power and toughness 0/1.' }),
  makeCard({ name: 'Shifter', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: This creature becomes the creature type of your choice until end of turn.\n{0}: This creature becomes the color of your choice until end of turn.' }),
  makeCard({ name: 'Flood', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land\nEnchanted land is an Island.' }),
  makeCard({ name: 'Bog', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
];

const attachTo = (g: GameState, aura: string, to: string) => {
  g.objects[aura]!.attachedTo = { id: to, zcc: g.objects[to]!.zcc };
};

describe('layers 4–6 (CR 613.1d–f)', () => {
  it('"loses all abilities and is a blue Frog creature with base power and toughness 1/1"', () => {
    const g = toStep(start({ extra: CARDS }), 'main1');
    const angel = give(g, 'alice', 'Angel', 'battlefield');
    const curse = give(g, 'bob', 'Frog Curse', 'battlefield');
    attachTo(g, curse, angel);
    const o = g.objects[angel]!;
    const c = chars(g, o);
    expect([power(g, o), toughness(g, o)]).toEqual([1, 1]);
    expect(c.colors).toEqual(['U']);
    expect(c.subtypes).toEqual(['Frog']);
    expect(hasKeyword(g, o, 'flying')).toBe(false);
    // Its activated ability is gone too.
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === angel)).toBe(false);
  });

  it('a mana creature that loses all abilities makes no mana; "until end of turn" ends', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Mystic', 'battlefield');
    const h = give(g, 'alice', 'Hush', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === m)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: h, targets: [[{ kind: 'object', object: m }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect([power(g, g.objects[m]!), toughness(g, g.objects[m]!)]).toEqual([0, 1]);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === m)).toBe(false);
    g = toStep(g, 'upkeep', 'bob');
    expect(manaAbilities(g, g.objects[m]!).length).toBe(1);
    expect(power(g, g.objects[m]!)).toBe(1);
  });

  it('"becomes the creature type / color of your choice until end of turn"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const s = give(g, 'alice', 'Shifter', 'battlefield');
    const run = (ability: number, choice: string) => {
      g = act(g, { type: 'activate', player: 'alice', object: s, ability });
      for (let i = 0; i < 6 && (g.stack.length || g.pending); i++) {
        if (g.pending?.kind === 'choose_option') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice } });
        else g = act(g, { type: 'pass', player: g.priority! });
      }
    };
    run(0, 'Goblin');
    expect(chars(g, g.objects[s]!).subtypes).toEqual(['Goblin']);
    run(1, 'R');
    expect(chars(g, g.objects[s]!).colors).toEqual(['R']);
  });

  it('CR 305.7: "Enchanted land is an Island" — it taps for {U} instead', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bog = give(g, 'alice', 'Bog', 'battlefield');
    const flood = give(g, 'bob', 'Flood', 'battlefield');
    attachTo(g, flood, bog);
    expect(chars(g, g.objects[bog]!).subtypes).toEqual(['Island']);
    const g2 = act(g, { type: 'activate_mana', player: 'alice', object: bog, ability: 0 });
    expect(g2.players.alice!.pool).toMatchObject({ U: 1, B: 0 });
  });
});

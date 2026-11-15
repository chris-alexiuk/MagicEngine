/**
 * What modifies an effect is read once, for whatever the effect is: how long it lasts, a condition on it, a counted
 * amount, "if you do", and where an ability works from. What each then does at the table is tested in the engine
 * (duration, modifiers, if-you-do and graveyard-triggers tests there); here, what is read — and what isn't.
 */
import { describe, expect, it } from 'vitest';
import { CONDITIONAL_STATICS, COUNTER_LASTING, DOABLE, DURATIONS, LASTING_EFFECTS } from '@mtg/schema';
import { compileCards } from '../src/compile.js';
import type { ScryfallCard } from '../src/scryfall.js';

const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common' }) as ScryfallCard;
const read = (oracle_text: string, type_line = 'Sorcery', name = 'Probe') => {
  const c = compileCards([card(name, type_line, oracle_text)]).db.cards.find((x) => x.name === name)!;
  const face = c.faces[0]!;
  return { grade: c.automation, unread: [...face.unparsed, ...(face.manualKeywords ?? [])], abilities: face.abilities, effects: (face.abilities[0] as { effects?: unknown[] } | undefined)?.effects ?? [] };
};

describe('how long an effect lasts, read once for every effect that lasts', () => {
  it('each duration, on effects that have no reader of their own for it', () => {
    const cases: [string, string, object][] = [
      ['Gain control of target creature until your next turn.', 'Sorcery', { type: 'gain_control', until: 'your_next_turn' }],
      ['Gain control of target creature until the end of your next turn.', 'Sorcery', { type: 'gain_control', until: 'end_of_your_next_turn' }],
      ['Gain control of target creature until end of combat.', 'Instant', { type: 'gain_control', until: 'eoc' }],
      ["Switch target creature's power and toughness until your next turn.", 'Instant', { type: 'modify', switchPT: true, until: 'your_next_turn' }],
      ['{T}: Gain control of target creature for as long as you control this creature and this creature remains tapped.', 'Creature — Faerie', { type: 'gain_control', until: 'source_controlled_tapped' }],
      ['{T}: Target land becomes a Swamp until this creature leaves the battlefield.', 'Creature — Avatar', { type: 'modify', landTypes: ['Swamp'], until: 'source_present' }],
      ['Until your next turn, target creature gets -2/-0.', 'Instant', { type: 'modify', power: -2, until: 'your_next_turn' }],
    ];
    for (const [text, type, node] of cases) {
      const r = read(text, type);
      expect([text, r.grade]).toEqual([text, 'full']);
      expect(r.effects[0]).toMatchObject(node);
    }
  });

  it('"for as long as it has a [kind] counter on it": the effect and the counter it hangs on', () => {
    const r = read('Put a shield counter on target creature. You gain control of that creature for as long as it has a shield counter on it.');
    expect(r.grade).toBe('full');
    expect(r.effects[1]).toMatchObject({ type: 'gain_control', until: 'game', whileCounter: 'shield' });
    const granted = read('Put a bounty counter on target creature. For as long as that creature has a bounty counter on it, it has "When this creature dies, draw a card."');
    expect(granted.effects[1]).toMatchObject({ type: 'modify', until: 'game', whileCounter: 'bounty', keywords: [{ id: 'ability' }] });
  });

  it('a triggered ability made for a while takes "until your next turn" too', () => {
    const r = read('Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.');
    expect(r.grade).toBe('full');
    // The ability lasts until your next turn; what it does each time lasts the turn.
    expect(r.effects).toMatchObject([{ type: 'turn_trigger', until: 'your_next_turn', ability: { trigger: { type: 'attacks' }, effects: [{ type: 'modify', until: 'eot' }] } }]);
    // "Until end of turn, whenever …" is as it was: no duration on the node.
    expect(read('Until end of turn, whenever a creature attacks you, it gets -1/-0 until end of turn.').effects[0]).not.toHaveProperty('until');
  });

  it('a duration the effect can\'t have is left unread', () => {
    // A rule for a player is kept by turn number (schema LASTING_EFFECTS): it can't hang on a permanent staying tapped.
    for (const text of ["{T}: Target opponent can't cast spells for as long as this creature remains tapped.", 'Counter target spell until your next turn.']) expect([text, read(text, 'Creature — Elf').grade]).not.toEqual([text, 'full']);
  });

  it('the tables the grammar reads by name every duration and every kind the engine ends', () => {
    for (const [kind, list] of Object.entries(LASTING_EFFECTS)) expect([kind, list.every((d) => DURATIONS.includes(d))]).toEqual([kind, true]);
    for (const kind of COUNTER_LASTING) expect(Object.keys(LASTING_EFFECTS)).toContain(kind);
  });
});

describe('a condition, read once for whatever it is on', () => {
  it('"[effect] if [condition]" and "[effect] unless [condition]"', () => {
    expect(read('Destroy target artifact if its mana value is 2 or less.').effects).toMatchObject([{ type: 'if', effects: [{ type: 'destroy' }] }]);
    // "Unless": nothing if the condition holds, the effect otherwise.
    expect(read('You gain 4 life unless you control an artifact.').effects).toMatchObject([{ type: 'if', cond: { type: 'count' }, effects: [], else: [{ type: 'gain_life', amount: 4 }] }]);
    expect(read('Gain control of target creature until your next turn unless you control an artifact.').effects).toMatchObject([{ type: 'if', effects: [], else: [{ type: 'gain_control', until: 'your_next_turn' }] }]);
  });

  it('a static ability that holds only while its condition does', () => {
    const r = read('As long as this creature is tapped, you may cast spells as though they had flash.', 'Creature — Cat');
    expect(r.grade).toBe('full');
    const effect = (r.abilities[0] as { effect: { type: string; condition?: unknown } }).effect;
    expect(CONDITIONAL_STATICS).toContain(effect.type);
    expect(effect.condition).toBeTruthy();
    const unless = read("This creature doesn't untap during your untap step unless you control an artifact.", 'Creature — Giant');
    expect((unless.abilities[0] as { effect: { condition?: { type: string } } }).effect.condition).toMatchObject({ type: 'not' });
  });

  it('a sentence that read before reads the same: the shared readers only see what nothing else reads', () => {
    // Deathbringer Liege: "you may destroy target creature if it's tapped" keeps its own shape — the choice inside the
    // condition, not around it (a first cut of the shared readers turned it inside out).
    const r = read("Whenever you cast a black spell, you may destroy target creature if it's tapped.", 'Creature — Horror');
    expect(r.grade).toBe('full');
    expect((r.abilities[0] as { effects: unknown[] }).effects).toMatchObject([{ type: 'if', cond: { type: 'is', filter: { tapped: true } }, effects: [{ type: 'may', effects: [{ type: 'destroy' }] }] }]);
  });

  it('"… unless [a player] pays" is a payment, not a condition', () => {
    expect(read('Counter target spell unless its controller pays {2}.', 'Instant').effects).toMatchObject([{ type: 'unless_pays' }]);
  });
});

describe('a counted amount, for every effect that takes a number', () => {
  it('"X" where the reader only knew numbers', () => {
    const r = read('Distribute X +1/+1 counters among any number of target creatures you control.');
    expect(r.grade).toBe('full');
    expect(JSON.stringify(r.effects)).toContain('"X"');
    expect(JSON.stringify(r.effects)).not.toContain('987');
  });
});

describe('"[do this]. If you do, [that]", for any instruction the engine can tell was done', () => {
  it('by the kind of instruction, not its wording', () => {
    const cases: [string, string][] = [
      ['Sacrifice a creature. If you do, draw two cards.', 'sacrifice_choice'],
      ['Discard a card. If you do, draw a card.', 'discard'],
      ["Tap target untapped creature you control. If you do, add an amount of {C} equal to that creature's mana value.", 'tap'],
      ['Exile up to one target creature card from your graveyard. If you do, you gain 2 life.', 'move'],
      ['Mill two cards. If you do, draw a card.', 'mill'],
    ];
    for (const [text, kind] of cases) {
      const r = read(text);
      expect([text, r.grade]).toEqual([text, 'full']);
      expect(r.effects).toMatchObject([{ type: 'may_do', mandatory: true, effects: [{ type: kind }] }]);
      expect(DOABLE).toContain(kind);
    }
  });

  it('what is done only if a condition holds, and what happens otherwise', () => {
    const r = read('Whenever a player casts a noncreature spell, put a collection counter on this enchantment. Then if there are three or more collection counters on it, sacrifice it. If you do, draw a card.', 'Enchantment');
    expect((r.abilities[0] as { effects: unknown[] }).effects).toMatchObject([{ type: 'add_counters' }, { type: 'may_do', mandatory: true, effects: [{ type: 'if', effects: [{ type: 'sacrifice' }] }], then: [{ type: 'draw' }] }]);
    const troll = read('At the beginning of your upkeep, exile a creature card from your graveyard. If you do, put a +1/+1 counter on this creature. Otherwise, sacrifice it.', 'Creature — Troll');
    expect((troll.abilities[0] as { effects: unknown[] }).effects).toMatchObject([{ type: 'may_do', mandatory: true, then: [{ type: 'add_counters' }], else: [{ type: 'sacrifice' }] }]);
  });

  it('an instruction the engine can\'t tell was done is never followed by "if you do"', () => {
    for (const text of ['You gain 3 life. If you do, draw a card.', 'Destroy all creatures. If you do, draw a card.']) expect([text, read(text).grade]).not.toEqual([text, 'full']);
  });
});

describe('where an ability works from, read from its condition', () => {
  it('"…, if this card is in your graveyard, …": from the graveyard, whatever it triggers on', () => {
    for (const text of [
      'Whenever you surveil, if this card is in your graveyard, you may pay 3 life. If you do, return this card to your hand.',
      'Whenever a nontoken creature is put into your graveyard from the battlefield, if this card is in your graveyard, create a 2/2 black Zombie creature token.',
      'At the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.',
    ]) {
      const r = read(text, 'Creature — Zombie');
      expect([text, r.grade]).toEqual([text, 'full']);
      expect(r.abilities[0]).toMatchObject({ kind: 'triggered', zone: 'graveyard', condition: { type: 'is', of: { ref: 'self' }, filter: { zone: 'graveyard' } } });
    }
  });
});

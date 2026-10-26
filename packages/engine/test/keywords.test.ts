import { describe, expect, it } from 'vitest';
import { chars, power, toughness, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const creature = (name: string, oracle_text: string, pt = '2', type = 'Creature — Human Monk') =>
  makeCard({ name, type_line: type, oracle_text, mana_cost: '{G}', power: pt, toughness: pt });
const spell = (name: string, oracle_text: string, type = 'Instant', mana_cost = '{G}') => makeCard({ name, type_line: type, oracle_text, mana_cost });

const CARDS = [
  creature('Monk', 'Prowess'),
  creature('Cycler', 'Cycling {2}'),
  creature('Plains Cycler', 'Plainscycling {1}'),
  creature('Spirit Giver', 'Afterlife 2'),
  creature('Exalted Angel', 'Exalted'),
  creature('Warlord', 'Battle cry'),
  creature('Samurai', 'Bushido 1'),
  creature('Knight of Flanks', 'Flanking'),
  creature('Warded Bear', 'Ward {2}'),
  creature('Shapeshifter', 'Changeling', '1', 'Creature — Shapeshifter'),
  creature('Elf Lord', 'Other Elf creatures you control get +1/+1.', '2', 'Creature — Elf'),
  spell('Shock', 'Shock deals 2 damage to any target.'),
  spell('Think Twice', 'Draw a card.\nFlashback {G}{G}'),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)' }),
];

function setup(lands = 4): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });
const attack = (g: GameState, attackers: string[]) =>
  act(passRound(toStep(g, 'beginning_of_combat')), {
    type: 'choose',
    player: 'alice',
    answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) },
  });

describe('keywords defined by the Comprehensive Rules (CR 702)', () => {
  it('compiles a keyword’s abilities from its definition: prowess (CR 702.108a)', () => {
    const face = CARDS[0]!.faces[0]!;
    expect(face.keywords[0]).toMatchObject({ id: 'prowess', abilities: [{ kind: 'triggered', text: 'Prowess', trigger: { type: 'cast' } }] });
    let g = setup();
    const monk = give(g, 'alice', 'Monk', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.stack.map((e) => e.kind)).toEqual(['spell', 'ability']);
    g = passRound(g);
    expect(power(g, g.objects[monk]!)).toBe(3);
  });

  it('CR 702.29a: cycling works from the hand — pay, discard it, draw', () => {
    let g = setup();
    const card = give(g, 'alice', 'Cycler', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'activate', player: 'alice', object: card, ability: 0, autoTap: true });
    expect(g.objects[card]!.zone).toBe('graveyard');
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand); // one discarded, one drawn
    expect(illegal(g, { type: 'activate', player: 'alice', object: give(g, 'bob', 'Cycler', 'hand'), ability: 0 })).toMatch(/can’t activate/);
  });

  it('CR 702.29e: typecycling searches for the type', () => {
    let g = setup();
    give(g, 'alice', 'Plains', 'library');
    const card = give(g, 'alice', 'Plains Cycler', 'hand');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: card, ability: 0, autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'search', count: 1 });
    const p = g.pending as Extract<typeof g.pending, { kind: 'search' }>;
    // Only Plains qualify — Forests and the rest of the deck don't.
    expect(p.candidates.length).toBeGreaterThan(0);
    expect(p.candidates.every((id) => g.objects[id]!.card === 'Plains')).toBe(true);
  });

  it('CR 702.135a: afterlife makes Spirits when it dies', () => {
    let g = setup();
    give(g, 'alice', 'Spirit Giver', 'battlefield');
    const giver = g.zones.battlefield.at(-1)!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: giver, to: 'graveyard' } });
    g = passRound(g);
    const spirits = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(spirits).toHaveLength(2);
    expect(g.cards[g.objects[spirits[0]!]!.card]!.faces[0]).toMatchObject({ name: 'Spirit Token', colors: ['W', 'B'], keywords: [{ id: 'flying' }] });
  });

  it('CR 702.83a / CR 506.5: exalted only when a creature attacks alone', () => {
    let g = setup();
    give(g, 'alice', 'Exalted Angel', 'battlefield', { sick: false });
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = attack(g, [bears]);
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Exalted Angel' }]);
    g = passRound(g);
    expect(power(g, g.objects[bears]!)).toBe(3);
  });

  it('CR 702.91a: battle cry pumps the other attackers', () => {
    let g = setup();
    const lord = give(g, 'alice', 'Warlord', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, [lord, bears]));
    expect([power(g, g.objects[lord]!), power(g, g.objects[bears]!)]).toEqual([2, 3]);
  });

  it('CR 702.45a / CR 509.3c: bushido when it blocks or becomes blocked', () => {
    let g = setup();
    const samurai = give(g, 'alice', 'Samurai', 'battlefield');
    const blocker = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, [samurai]));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: samurai }] } });
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Samurai' }]);
    g = passRound(g);
    expect(chars(g, g.objects[samurai]!)).toMatchObject({ power: 3, toughness: 3 });
  });

  it('CR 702.25a / CR 509.3d: flanking shrinks each blocker without flanking', () => {
    let g = setup();
    const knight = give(g, 'alice', 'Knight of Flanks', 'battlefield');
    const blocker = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, [knight]));
    g = passRound(act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: knight }] } }));
    expect(toughness(g, g.objects[blocker]!)).toBe(1);
  });

  it('CR 702.21a: ward counters an opponent’s spell unless they pay', () => {
    let g = setup(3);
    const warded = give(g, 'bob', 'Warded Bear', 'battlefield');
    const shock = give(g, 'alice', 'Shock', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: shock, autoTap: true, targets: [[obj(warded)]] });
    // Ward triggers on Bob's side, above the Shock.
    expect(g.stack.map((e) => (e.kind === 'spell' ? 'spell' : e.sourceName))).toEqual(['spell', 'Warded Bear']);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{2}' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } });
    expect(g.objects[shock]!.zone).toBe('graveyard');
    expect(g.stack).toEqual([]);
    expect(g.objects[warded]!.damage).toBe(0);
  });

  it('ward doesn’t trigger on its controller’s own spells', () => {
    let g = setup();
    const mine = give(g, 'alice', 'Warded Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), autoTap: true, targets: [[obj(mine)]] });
    expect(g.stack).toHaveLength(1);
  });

  it('CR 702.73a: changeling is every creature type', () => {
    const g = setup();
    give(g, 'alice', 'Elf Lord', 'battlefield');
    const changeling = give(g, 'alice', 'Shapeshifter', 'battlefield');
    expect(chars(g, g.objects[changeling]!).subtypes).toContain('Elf');
    expect(power(g, g.objects[changeling]!)).toBe(2);
  });

  it('CR 702.34a: flashback casts from the graveyard, then exiles it', () => {
    let g = setup();
    const think = give(g, 'alice', 'Think Twice', 'graveyard');
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: think, autoTap: true }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.objects[think]!.zone).toBe('exile');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'graveyard'), autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] })).toMatch(
      /from your hand/,
    );
  });
});

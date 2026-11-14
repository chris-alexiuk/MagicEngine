import { describe, expect, it } from 'vitest';
import { chars, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// A creature whose power and toughness come from a line the engine couldn't read used to enter as a 0/0 and die at once
// (CR 704.5f) — The Mimeoplasm, Neverwinter Hydra, every "*/*" whose own ability wasn't parsed. Its controller is
// asked for its size as it enters instead, and can correct it later; a planeswalker's loyalty the same way (CR 704.5i).

const blob = makeCard({ name: 'Test Blob', type_line: 'Creature — Ooze', mana_cost: '{1}{G}', power: '*', toughness: '*', oracle_text: "Test Blob's power and toughness are each equal to the number of bananas in your pockets." });
const sprout = makeCard({ name: 'Test Sprout', type_line: 'Creature — Plant', mana_cost: '{G}', power: '0', toughness: '0', oracle_text: 'Test Sprout enters with a +1/+1 counter on it for each banana in your pockets.' });
const walker = makeCard({ name: 'Test Walker', type_line: 'Legendary Planeswalker — Test', mana_cost: '{2}{G}', loyalty: '0', oracle_text: 'Test Walker enters with a loyalty counter on it for each banana in your pockets.\n+1: You gain 1 life.' });
const sturdy = makeCard({ name: 'Test Sturdy', type_line: 'Creature — Beast', mana_cost: '{2}{G}', power: '3', toughness: '3', oracle_text: 'Whenever a banana falls, Test Sturdy sings.' });
const counted = makeCard({ name: 'Test Counted', type_line: 'Creature — Elemental', mana_cost: '{1}{G}', power: '*', toughness: '*', oracle_text: "Test Counted's power and toughness are each equal to the number of lands you control." });
const hydra = makeCard({ name: 'Test Hydra', type_line: 'Creature — Hydra', mana_cost: '{X}{G}', power: '0', toughness: '0', oracle_text: 'Test Hydra enters with X +1/+1 counters on it.\nWhenever a banana falls, Test Hydra sings.' });
const ixidron = makeCard({ name: 'Ixidron', type_line: 'Creature — Illusion', mana_cost: '{3}{U}{U}', power: '*', toughness: '*', oracle_text: "As this creature enters, turn all other nontoken creatures face down. (They're 2/2 creatures.)\nIxidron's power and toughness are each equal to the number of face-down creatures on the battlefield." });
const extra = [blob, sprout, walker, sturdy, counted, hydra, ixidron];

function cast(name: string, x?: number): GameState {
  let g = toStep(start({ extra }), 'main1', 'alice');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  const id = give(g, 'alice', name, 'hand');
  g = act(g, { type: 'cast', player: 'alice', object: id, autoTap: true, ...(x !== undefined ? { x } : {}) });
  return passRound(g);
}
const onBattlefield = (g: GameState, name: string) => g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.card === name);

describe('a size the engine cannot read is set by hand', () => {
  it('the cards have a line the engine could not read: the one that sizes them', () => {
    for (const c of [blob, sprout, walker, sturdy, hydra]) expect(c.faces[0]!.unparsed.length, c.name).toBeGreaterThan(0);
    expect(counted.automation).toBe('full');
  });

  it('CR 704.5f waits: the creature is on the battlefield and its controller is asked, with the unread line', () => {
    const g = cast('Test Blob');
    expect(onBattlefield(g, 'Test Blob')).toBeDefined();
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'size', player: 'alice', lines: ["Test Blob's power and toughness are each equal to the number of bananas in your pockets."] });
  });

  it('what they set is its power and toughness', () => {
    let g = cast('Test Blob');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 3, toughness: 4 } } });
    const o = onBattlefield(g, 'Test Blob')!;
    expect([chars(g, o).power, chars(g, o).toughness]).toEqual([3, 4]);
    expect(g.pending).toBeNull();
    expect(g.priority).toBe('alice');
  });

  it('CR 122.6: counters it enters with are set along with it', () => {
    let g = cast('Test Sprout');
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'size' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 0, toughness: 0, counters: 3 } } });
    const o = onBattlefield(g, 'Test Sprout')!;
    expect(o.counters['+1/+1']).toBe(3);
    expect([chars(g, o).power, chars(g, o).toughness]).toEqual([3, 3]);
  });

  it('CR 704.5f applies again once it is set: a toughness of 0 is a creature that dies', () => {
    let g = cast('Test Blob');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 0, toughness: 0 } } });
    expect(onBattlefield(g, 'Test Blob')).toBeUndefined();
    expect(g.zones.graveyard.alice!.map((id) => g.objects[id]!.card)).toContain('Test Blob');
  });

  it('the size is changed by hand as the game changes what the line counts', () => {
    let g = cast('Test Blob');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 2, toughness: 2 } } });
    const id = onBattlefield(g, 'Test Blob')!.id;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'size', object: id, power: 5, toughness: 6 } });
    expect([chars(g, g.objects[id]!).power, chars(g, g.objects[id]!).toughness]).toEqual([5, 6]);
    expect(illegal(g, { type: 'manual', player: 'alice', op: { kind: 'size', object: id, power: 1.5, toughness: 2 } })).toMatch(/whole numbers/);
  });

  it('the answer has to be whole numbers', () => {
    const g = cast('Test Blob');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: -1, toughness: 2 } } })).toMatch(/whole numbers/);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters' } })).toMatch(/power and toughness/);
  });

  it('Ixidron: its size is read, but counts what an unread line would have set up — the size set by hand stands in for it', () => {
    expect(ixidron.faces[0]!.unparsed).toEqual(['As this creature enters, turn all other nontoken creatures face down.']);
    let g = toStep(start({ extra }), 'main1', 'alice');
    Object.assign(g.players.alice!.pool, { U: 2, C: 3 });
    const id = give(g, 'alice', 'Ixidron', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: id, autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'size' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 3, toughness: 3 } } });
    expect(g.objects[id]!.zone).toBe('battlefield');
    expect([chars(g, g.objects[id]!).power, chars(g, g.objects[id]!).toughness]).toEqual([3, 3]);
  });

  it('CR 704.5i: a planeswalker whose loyalty is in an unread line is asked for it', () => {
    let g = cast('Test Walker');
    expect(onBattlefield(g, 'Test Walker')).toBeDefined();
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'loyalty' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', loyalty: 4 } });
    expect(onBattlefield(g, 'Test Walker')!.counters.loyalty).toBe(4);
  });

  it('CR 400.7: it is asked again when it comes back as a new object', () => {
    let g = cast('Test Blob');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', size: { power: 2, toughness: 2 } } });
    const id = onBattlefield(g, 'Test Blob')!.id;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: id, to: 'hand' } });
    expect(g.objects[id]!.handPT).toBeUndefined();
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: id, to: 'battlefield' } });
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'size' });
  });
});

describe('nothing is asked when the size is known', () => {
  it('a creature with a printed size and a line unread', () => {
    const g = cast('Test Sturdy');
    expect(g.pending).toBeNull();
    expect(chars(g, onBattlefield(g, 'Test Sturdy')!).toughness).toBe(3);
  });

  it('a "*/*" whose own ability was read', () => {
    const g = cast('Test Counted');
    expect(g.pending).toBeNull();
    expect(chars(g, onBattlefield(g, 'Test Counted')!).toughness).toBe(4);
  });

  it('a 0/0 that entered with counters from a line that was read', () => {
    const g = cast('Test Hydra', 2);
    expect(g.pending).toBeNull();
    expect(onBattlefield(g, 'Test Hydra')!.counters['+1/+1']).toBe(2);
  });
});

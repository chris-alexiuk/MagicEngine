import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, legalActions, type GameState } from '../src/index.js';
import { faceOf } from '../src/zones.js';
import { nameOf } from '../src/zones.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

// CR 707.9: a copy effect's exceptions are part of the copy's copiable values — so a keyword the copy is given
// ("except it has vanishing 3", "haste and dethrone", "a Vehicle artifact with crew 3", "has myriad") is on the copy
// as it would be printed on a card: with the abilities that keyword stands for.
const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{U}{U}', cmc: 2, ...extra });
const CARDS = [
  card('Flesh Duplicate', 'Creature — Shapeshifter Rebel', "You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn't have vanishing. (A permanent with vanishing 3 enters with three time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)", { power: '0', toughness: '0' }),
  card("Dack's Duplicate", 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield, except it has haste and dethrone. (Whenever it attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)', { mana_cost: '{2}{U}{R}', cmc: 4, power: '0', toughness: '0' }),
  card('Imposter Mech', 'Artifact — Vehicle', "You may have this Vehicle enter as a copy of a creature an opponent controls, except it's a Vehicle artifact with crew 3 and it loses all other card types.\nCrew 3", { mana_cost: '{1}{U}', power: '3', toughness: '1' }),
  card('Auton Soldier', 'Artifact Creature — Shapeshifter', "You may have this creature enter as a copy of any creature on the battlefield, except it isn't legendary, is an artifact in addition to its other types, and has myriad.", { mana_cost: '{3}{U}', cmc: 4, power: '0', toughness: '0' }),
  card('Evil Twin', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield, except it has "{U}{B}, {T}: Destroy target creature with the same name as this creature."', { mana_cost: '{2}{U}{B}', cmc: 4, power: '0', toughness: '0' }),
  card('Wall of Stolen Identity', 'Creature — Shapeshifter Wall', "You may have this creature enter as a copy of any creature on the battlefield, except it's a Wall in addition to its other types and has defender. When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control this creature.", { mana_cost: '{2}{U}{U}', cmc: 4, power: '0', toughness: '0' }),
  card('Vizier of Many Faces', 'Creature — Human Cleric', "You may have this creature enter as a copy of any creature on the battlefield, except if this creature was embalmed, the token has no mana cost, it's white, and it's a Zombie in addition to its other types.\nEmbalm {3}{U}{U} ({3}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it. Activate only as a sorcery.)", { mana_cost: '{2}{U}{U}', cmc: 4, power: '0', toughness: '0' }),
  card('Bear', 'Creature — Bear', '', { mana_cost: '{1}{G}', power: '2', toughness: '2' }),
  card('Ogre', 'Creature — Ogre', '', { mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3' }),
  card('Fading Brute', 'Creature — Elemental', 'Vanishing 2', { mana_cost: '{2}{R}', cmc: 3, power: '4', toughness: '4' }),
];
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};
/** Casts a clone from hand and answers what it copies (null: nothing). */
function enterAs(g: GameState, name: string, copy: string | null): { g: GameState; id: string } {
  const id = give(g, 'alice', name, 'hand');
  g.players.alice!.pool = { W: 0, U: 4, B: 1, R: 1, G: 0, C: 0 };
  g = settle(act(g, { type: 'cast', player: 'alice', object: id }));
  expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'copy', player: 'alice' });
  g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy } }));
  g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  return { g, id };
}
/** To the next upkeep of alice's, with its triggers resolved. */
const nextUpkeep = (g: GameState) => settle(toStep(toStep(g, 'end', 'alice'), 'upkeep', 'alice'));
const vanishings = (g: GameState, id: string) => chars(g, g.objects[id]!).keywords.filter((k) => k.id === 'vanishing').map((k) => k.n);

describe('Flesh Duplicate: "… except it has vanishing 3 if that creature doesn’t have vanishing"', () => {
  it('a copy of a creature without vanishing: three time counters, one off each upkeep, sacrificed with the last', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, 'Flesh Duplicate', bear);
    g = r.g;
    const dup = () => g.objects[r.id]!;
    expect([nameOf(g, dup()), dup().zone, chars(g, dup()).power, chars(g, dup()).toughness]).toEqual(['Bear', 'battlefield', 2, 2]);
    expect(vanishings(g, r.id)).toEqual([3]);
    expect(dup().counters.time).toBe(3);
    g = nextUpkeep(g);
    expect([dup().zone, dup().counters.time]).toEqual(['battlefield', 2]);
    g = nextUpkeep(g);
    expect([dup().zone, dup().counters.time]).toEqual(['battlefield', 1]);
    // The last counter comes off: it's sacrificed (and is Flesh Duplicate again in the graveyard).
    g = nextUpkeep(g);
    expect([dup().zone, nameOf(g, dup())]).toEqual(['graveyard', 'Flesh Duplicate']);
    // The creature it copied is untouched.
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('a copy of a creature that has vanishing gets only that creature’s vanishing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const brute = give(g, 'bob', 'Fading Brute', 'battlefield');
    const r = enterAs(g, 'Flesh Duplicate', brute);
    g = r.g;
    expect(nameOf(g, g.objects[r.id]!)).toBe('Fading Brute');
    expect(vanishings(g, r.id)).toEqual([2]);
    expect(g.objects[r.id]!.counters.time).toBe(2);
  });

  it('copying nothing leaves a 0/0, which dies (CR 704.5f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, 'Flesh Duplicate', null);
    expect(r.g.objects[r.id]!.zone).toBe('graveyard');
  });
});

describe('other keywords a copy is given work as printed', () => {
  it("Dack's Duplicate: haste, and dethrone puts a counter on it as it attacks the player with the most life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, "Dack's Duplicate", bear);
    g = r.g;
    expect([nameOf(g, g.objects[r.id]!), hasKeyword(g, g.objects[r.id]!, 'haste'), hasKeyword(g, g.objects[r.id]!, 'dethrone')]).toEqual(['Bear', true, true]);
    // It came in this turn and attacks anyway; bob is tied for the most life.
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: r.id, target: { kind: 'player', player: 'bob' } }] } }));
    expect(g.objects[r.id]!.counters['+1/+1']).toBe(1);
    expect(chars(g, g.objects[r.id]!).power).toBe(3);
  });

  it('Imposter Mech: the copy is a Vehicle that a creature with power 3 can crew', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const small = give(g, 'alice', 'Bear', 'battlefield');
    const r = enterAs(g, 'Imposter Mech', bear);
    g = r.g;
    const mech = () => chars(g, g.objects[r.id]!);
    expect([mech().name, mech().types, mech().subtypes]).toEqual(['Bear', ['Artifact'], ['Vehicle']]);
    // A 2/2 isn't enough; the 3/3 is. Crewed, it's an artifact creature until end of turn (CR 702.122a).
    expect(() => act(g, { type: 'activate', player: 'alice', object: r.id, ability: 0, costs: { crew: [small] } })).toThrow();
    g = settle(act(g, { type: 'activate', player: 'alice', object: r.id, ability: 0, costs: { crew: [ogre] } }));
    expect(g.objects[ogre]!.tapped).toBe(true);
    expect([...mech().types].sort()).toEqual(['Artifact', 'Creature']);
    expect([mech().power, mech().toughness]).toEqual([2, 2]);
  });

  it('Auton Soldier: the copy has myriad — as it attacks, a token copy attacks each other opponent', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, 'Auton Soldier', bear);
    g = r.g;
    expect([nameOf(g, g.objects[r.id]!), [...chars(g, g.objects[r.id]!).types].sort()]).toEqual(['Bear', ['Artifact', 'Creature']]);
    // (A turn later: it has no haste.)
    g = toStep(toStep(g, 'end', 'alice'), 'main1', 'alice');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: r.id, target: { kind: 'player', player: 'bob' } }] } }));
    const tokens = Object.keys(g.combat!.attackers).filter((id) => g.objects[id]!.token);
    expect(tokens.map((id) => (g.combat!.attackers[id]!.target as { player: string }).player)).toEqual(['carol']);
    expect(nameOf(g, g.objects[tokens[0]!]!)).toBe('Bear');
  });
});

// A clone whose exception the compiler can't read whole still enters as a copy — a 0/0 that didn't would die as it
// arrived, with nothing a player could do about it — and what wasn't read is on the copy as lines resolved by hand.
describe('a clone with an exception the engine can’t run', () => {
  it('Evil Twin: enters as the copy; its quoted ability is a line of the copy that is activated by hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const id = give(g, 'alice', 'Evil Twin', 'hand');
    g.players.alice!.pool = { W: 0, U: 3, B: 1, R: 0, G: 0, C: 0 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: id }));
    // The choice says what is left to the player.
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'copy', candidates: [bear] });
    expect((g.pending as { text: string }).text).toContain('yours to do by hand: {U}{B}, {T}: Destroy target creature with the same name as this creature.');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } }));
    const twin = g.objects[id]!;
    expect([nameOf(g, twin), twin.zone, chars(g, twin).power]).toEqual(['Bear', 'battlefield', 2]);
    const line = '{U}{B}, {T}: Destroy target creature with the same name as this creature.';
    expect(faceOf(g, twin).unparsed).toEqual([line]);
    expect(faceOf(g, twin).oracle.split('\n')).toContain(line);
    // A turn later (no haste), with the mana for it: the line is offered, paid for, and put on the stack to resolve by hand.
    g = toStep(toStep(g, 'end', 'alice'), 'main1', 'alice');
    g.players.alice!.pool = { W: 0, U: 1, B: 1, R: 0, G: 0, C: 0 };
    const manual = legalActions(g, 'alice').find((a) => a.type === 'activate_manual' && a.object === id);
    expect(manual).toMatchObject({ type: 'activate_manual', line: 0 });
    g = act(g, manual!);
    expect(g.objects[id]!.tapped).toBe(true);
    expect([g.players.alice!.pool.U, g.players.alice!.pool.B]).toEqual([0, 0]);
    expect(g.stack).toHaveLength(1);
    // The original is still what it was: the note is on the copy only.
    expect(faceOf(g, g.objects[bear]!).unparsed).toEqual([]);
  });

  it('Wall of Stolen Identity: the parts that can be read are applied (a Wall with defender); the rest is a line by hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const r = enterAs(g, 'Wall of Stolen Identity', ogre);
    g = r.g;
    const wall = g.objects[r.id]!;
    expect([nameOf(g, wall), chars(g, wall).power, chars(g, wall).subtypes, hasKeyword(g, wall, 'defender')]).toEqual(['Ogre', 3, ['Ogre', 'Wall'], true]);
    expect(faceOf(g, wall).unparsed).toEqual(["When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control this creature."]);
  });

  it('Vizier of Many Faces, cast: a plain copy — nothing of "if this creature was embalmed, …" is applied', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, 'Vizier of Many Faces', bear);
    g = r.g;
    const c = chars(g, g.objects[r.id]!);
    expect([c.name, c.colors, c.subtypes, c.power]).toEqual(['Bear', ['G'], ['Bear'], 2]);
  });

  it('declining to copy is still a 0/0 that dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Bear', 'battlefield');
    const r = enterAs(g, 'Evil Twin', null);
    expect(r.g.objects[r.id]!.zone).toBe('graveyard');
  });
});

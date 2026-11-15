import { describe, expect, it } from 'vitest';
import { byHand } from '@mtg/schema';
import { chars, legalActions, type Action, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * One sentence by hand, not the whole ability. Where one sentence of a spell or ability is unread and stands apart
 * from the rest, the engine carries out the others and stops at that one for its controller to do by hand; and a
 * triggered ability whose trigger reads goes on the stack when it triggers even if nothing of what it does was read.
 * (The wordings are Stream of Thought's, Worldfire's, Conduit of Storms' and Season of the Witch's.)
 */
const CARDS = [
  makeCard({ name: 'Stream', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills four cards. You shuffle up to four cards from your graveyard into your library.' }),
  makeCard({ name: 'Fire', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1." }),
  makeCard({ name: 'Conduit', type_line: 'Creature — Werewolf', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Whenever this creature attacks, add {C}{C} at the beginning of your next main phase this turn.' }),
  makeCard({ name: 'Season', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of the end step, destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack." }),
  makeCard({ name: 'Charm', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one or both —\n• You gain 3 life.\n• Roll a d20 and subtract the number of cards in your hand.' }),
  makeCard({ name: 'Aimed Charm', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one or both —\n• You gain 3 life.\n• Target creature phases out until its controller rolls a 20 on a d20.' }),
  makeCard({ name: 'Rise', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way.' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...more }));
const done = (g: GameState) => settle(act(g, { type: 'choose', player: g.pending!.player, answer: { kind: 'manual_resolution', done: true } }));
const card = (name: string) => CARDS.find((c) => c.name === name)!;

describe('one sentence by hand, the others carried out', () => {
  it('such a card is never graded fully automatic, and says which sentence is the player\'s', () => {
    expect(card('Stream').automation).toBe('partial');
    expect(card('Stream').faces[0]!.unparsed).toEqual([]);
    expect(byHand(card('Stream').faces[0]!.abilities)).toEqual(['You shuffle up to four cards from your graveyard into your library.']);
    expect(byHand(card('Fire').faces[0]!.abilities)).toEqual(['Exile all cards from all hands and graveyards.']);
  });

  it('the engine does what it read, then stops at the sentence for its controller', () => {
    let g = main();
    const yard = give(g, 'alice', 'Bear', 'graveyard');
    const before = g.zones.library.bob!.length;
    g = cast(g, 'Stream', { targets: [[{ kind: 'player', player: 'bob' }]] });
    // Milled, by the engine.
    expect(g.zones.library.bob!.length).toBe(before - 4);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice', step: true, text: 'You shuffle up to four cards from your graveyard into your library.' });
    // By hand, with the table's manual moves — only its controller, and nothing else goes on meanwhile.
    expect(legalActions(g, 'bob')).toEqual([]);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: yard, to: 'library', position: 'top' } });
    expect(g.objects[yard]!.zone).toBe('library');
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', step: true });
    g = done(g);
    // The spell has finished resolving.
    expect([g.pending, g.stack.length]).toEqual([null, 0]);
    expect(g.zones.graveyard.alice!.map((id) => chars(g, g.objects[id]!).name)).toContain('Stream');
  });

  it('a sentence in the middle: what comes after it is carried out once it is done', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Fire');
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', step: true, text: 'Exile all cards from all hands and graveyards.' });
    // Not yet: the life totals change after the sentence done by hand.
    expect(g.players.alice!.life).toBeGreaterThan(1);
    g = done(g);
    expect([g.players.alice!.life, g.players.bob!.life, g.pending]).toEqual([1, 1, null]);
  });

  it('nothing is checked between the engine\'s part and the player\'s: a 0/0 lives to get its counters (CR 704.3)', () => {
    // Rise and Shine's wording: the engine makes the artifact a 0/0 creature, the player puts the counters on.
    let g = main();
    const relic = give(g, 'alice', 'Relic', 'battlefield');
    g = cast(g, 'Rise', { targets: [[{ kind: 'object', object: relic }]] });
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', step: true, text: 'Put four +1/+1 counters on each artifact that became a creature this way.' });
    const size = (x: GameState, id: string) => [x.objects[id]!.zone, chars(x, x.objects[id]!).types.includes('Creature'), chars(x, x.objects[id]!).power, chars(x, x.objects[id]!).toughness];
    expect(size(g, relic)).toEqual(['battlefield', true, 0, 0]);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'counters', object: relic, counter: '+1/+1', delta: 4 } });
    expect(size(g, relic)).toEqual(['battlefield', true, 4, 4]);
    g = done(g);
    expect([g.pending, size(g, relic)]).toEqual([null, ['battlefield', true, 4, 4]]);
    // Left undone, it is a 0/0 once the spell has finished resolving.
    let h = main();
    const other = give(h, 'alice', 'Relic', 'battlefield');
    h = done(cast(h, 'Rise', { targets: [[{ kind: 'object', object: other }]] }));
    expect(h.objects[other]!.zone).toBe('graveyard');
  });
});

describe('a triggered ability whose trigger reads and whose effect doesn\'t', () => {
  it('the line stays an unread one; the ability knows only when it triggers', () => {
    const face = card('Conduit').faces[0]!;
    expect(card('Conduit').automation).toBe('manual');
    expect(face.unparsed).toEqual(['Whenever this creature attacks, add {C}{C} at the beginning of your next main phase this turn.']);
    expect(face.abilities).toMatchObject([{ kind: 'triggered', trigger: { type: 'attacks', subject: { ref: 'self' } }, effects: [], manual: true }]);
    expect(card('Season').faces[0]!.abilities).toMatchObject([{ kind: 'triggered', trigger: { type: 'phase', step: 'end', whose: 'each' }, manual: true }]);
  });

  it('it goes on the stack when it triggers, and its controller resolves it by hand', () => {
    let g = main();
    const conduit = give(g, 'alice', 'Conduit', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: conduit, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Conduit' }]);
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice', text: 'Whenever this creature attacks, add {C}{C} at the beginning of your next main phase this turn.' });
    expect((g.pending as { step?: true }).step).toBeUndefined();
    g = done(g);
    expect([g.pending, g.stack.length]).toEqual([null, 0]);
  });

  it('at each end step, for whoever controls it', () => {
    let g = main();
    give(g, 'alice', 'Season', 'battlefield');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice' });
    g = done(g);
    g = settle(toStep(g, 'end', 'bob'));
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice' });
  });
});

describe('a mode nothing reads, chosen with one that reads', () => {
  it('the mode that reads is carried out; the other is done by hand where it comes', () => {
    let g = main();
    const life = g.players.alice!.life;
    g = cast(g, 'Charm', { modes: [0, 1] });
    expect(g.players.alice!.life).toBe(life + 3);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', step: true, text: 'Roll a d20 and subtract the number of cards in your hand.' });
    g = done(g);
    expect([g.pending, g.stack.length]).toEqual([null, 0]);
  });

  it('one with a target of its own: the whole spell is resolved by hand, as before', () => {
    let g = main();
    const life = g.players.alice!.life;
    give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Aimed Charm', { modes: [0, 1] });
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice' });
    expect((g.pending as { step?: true }).step).toBeUndefined();
    expect(g.players.alice!.life).toBe(life);
  });
});

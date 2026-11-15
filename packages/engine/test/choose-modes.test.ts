import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../src/index.js';
import { choiceModes, legalActions } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * CR 700.2: a modal spell is cast with any of its modes that can be chosen. The list of legal actions offers the cast
 * with a default set of modes — and has to offer it whichever modes those are, not only modes printed next to each other.
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  // Kolaghan's Command.
  card('Command', 'Instant', 'Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Command deals 2 damage to any target.'),
  card('Triad', 'Instant', 'Choose three —\n• Destroy target artifact.\n• You gain 2 life.\n• Destroy target enchantment.\n• Draw a card.\n• Target player loses 1 life.'),
  card('Trinket', 'Artifact', ''),
];
type Cast = Extract<Action, { type: 'cast' }>;
const listed = (g: GameState, id: string): Cast | undefined => legalActions(g, 'alice').find((a): a is Cast => a.type === 'cast' && a.object === id);
const settle = (g: GameState): GameState => {
  for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = passRound(g);
  return g;
};

describe('CR 700.2: the modes a listed cast offers', () => {
  it('"Choose two —": the first two modes when they can be chosen, as before', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const spell = give(g, 'alice', 'Command', 'hand');
    expect(listed(g, spell)?.modes).toEqual([0, 1]);
  });

  it('"Choose two —": modes that aren\'t next to each other, when those are the ones with something to target', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Command', 'hand');
    // No creature card in her graveyard, no artifact anywhere: a player discards, and 2 damage.
    const cast = listed(g, spell);
    expect(cast?.modes).toEqual([1, 3]);
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { ...cast!, targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }]] }));
    while (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, 1) } });
    g = settle(g);
    expect(g.players.bob!.life).toBe(18);
    expect(g.zones.hand.bob!.length).toBe(hand - 1);
  });

  it('"Choose two —": the default stays what it was wherever modes next to each other can be chosen', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grizzly Bears', 'graveyard');
    give(g, 'bob', 'Trinket', 'battlefield');
    const spell = give(g, 'alice', 'Command', 'hand');
    // Every mode can be chosen: the default is still the first two.
    expect(listed(g, spell)?.modes).toEqual([0, 1]);
    // Without the creature card the first mode is out; of the sets left, modes next to each other come first.
    g.zones.graveyard.alice = [];
    expect(listed(g, spell)?.modes).toEqual([1, 2]);
  });

  it('"Choose three —" of five: any three that can be chosen', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Triad', 'hand');
    // No artifact, no enchantment: life, a card, and a player loses 1.
    expect(listed(g, spell)?.modes).toEqual([1, 3, 4]);
    give(g, 'bob', 'Trinket', 'battlefield');
    expect(listed(g, spell)?.modes).toEqual([0, 1, 3]);
  });

  it('the mode menu says which modes can\'t be chosen, mode by mode (CR 700.2a)', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Command', 'hand');
    const blocked = () => choiceModes(g, listed(g, spell)!)!.options.map((o) => Boolean(o.noTargets));
    expect(choiceModes(g, listed(g, spell)!)).toMatchObject({ min: 2, max: 2 });
    // No creature card in her graveyard, no artifact: the first and third are out; the other two can be chosen.
    expect(blocked()).toEqual([true, false, true, false]);
    give(g, 'bob', 'Trinket', 'battlefield');
    expect(blocked()).toEqual([true, false, false, false]);
    give(g, 'alice', 'Grizzly Bears', 'graveyard');
    expect(blocked()).toEqual([false, false, false, false]);
  });

  it('a mode that can\'t be chosen rules out that mode, not the spell — and with too few modes left, the spell', () => {
    const g = toStep(start({ extra: [...CARDS, card('Pair', 'Instant', 'Choose two —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Draw a card.')] }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Pair', 'hand');
    expect(listed(g, spell)).toBeUndefined();
    give(g, 'bob', 'Trinket', 'battlefield');
    expect(listed(g, spell)?.modes).toEqual([0, 2]);
  });
});

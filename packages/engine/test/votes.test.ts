import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({
    name: 'Bite of the Black Rose',
    type_line: 'Sorcery',
    mana_cost: '{0}',
    oracle_text:
      'Will of the council — Starting with you, each player votes for sickness or psychosis. If sickness gets more votes, creatures your opponents control get -2/-2 until end of turn. If psychosis gets more votes or the vote is tied, each opponent discards two cards.',
  }),
  makeCard({
    name: 'Lieutenants of the Guard',
    type_line: 'Creature — Human Soldier',
    mana_cost: '{0}',
    power: '1',
    toughness: '1',
    oracle_text:
      "Council's dilemma — When this creature enters, starting with you, each player votes for strength or numbers. Put a +1/+1 counter on this creature for each strength vote and create a 1/1 white Soldier creature token for each numbers vote.",
  }),
  makeCard({
    name: "Council's Judgment",
    type_line: 'Sorcery',
    mana_cost: '{0}',
    oracle_text: "Will of the council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.",
  }),
  makeCard({ name: 'Ballot Broker', type_line: 'Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'While voting, you may vote an additional time. (The votes can be for different choices or for the same choice.)' }),
  makeCard({
    name: 'Truth Game',
    type_line: 'Sorcery',
    mana_cost: '{0}',
    oracle_text: 'Secret council — Each player secretly votes for truth or consequences, then those votes are revealed. You draw cards equal to the number of truth votes.',
  }),
  makeCard({ name: 'Time Vote', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Council's dilemma — Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one." }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

/** Pass priority until the stack is empty, voting as `votes` says (in the order players are asked). */
function resolve(g: GameState, votes: string[]): { g: GameState; voters: PlayerId[] } {
  const voters: PlayerId[] = [];
  for (let guard = 0; guard < 50 && (g.stack.length || g.pending); guard++) {
    const p = g.pending;
    if (p?.kind === 'choose_option') {
      voters.push(p.player);
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_option', choice: votes[voters.length - 1]! } });
    } else if (p?.kind === 'choose_objects') {
      voters.push(p.player);
      const v = votes[voters.length - 1]!;
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: v ? [v] : [] } });
    } else if (p?.kind === 'discard') {
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'discard', objects: g.zones.hand[p.player]!.slice(0, p.count) } });
    } else if (p) {
      throw new Error(`unexpected ${p.kind}`);
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return { g, voters };
}

describe('CR 701.38: voting', () => {
  it('will of the council: each player votes in turn order starting with you; ties go to the second option', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bite of the Black Rose', 'hand') });
    const won = resolve(g, ['sickness', 'sickness', 'psychosis']);
    expect(won.voters).toEqual(['alice', 'bob', 'carol']);
    expect(won.g.zones.battlefield.includes(bear)).toBe(false);

    let h = toStep(start({ extra: CARDS, players: 2 }), 'main1', 'alice');
    const hand = h.zones.hand.bob!.length;
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bite of the Black Rose', 'hand') });
    const tied = resolve(h, ['sickness', 'psychosis']);
    expect(tied.g.zones.hand.bob!.length).toBe(hand - 2);
  });

  it("council's dilemma: \"for each strength vote\" and \"for each numbers vote\"", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const lt = give(g, 'alice', 'Lieutenants of the Guard', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: lt });
    const before = g.zones.battlefield.length;
    const { g: after } = resolve(g, ['strength', 'numbers', 'strength']);
    const me = after.zones.battlefield.map((id) => after.objects[id]!).find((o) => after.cards[o.card]!.name === 'Lieutenants of the Guard')!;
    expect(me.counters['+1/+1']).toBe(2);
    expect(after.zones.battlefield.length - before).toBe(2); // the creature itself and one Soldier
  });

  it("CR 701.38b: votes for objects — exile each with the most votes or tied; an additional vote (CR 701.38d)", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const a = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const c = give(g, 'carol', 'Grizzly Cub', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Cub', 'battlefield');
    give(g, 'bob', 'Ballot Broker', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Council's Judgment", 'hand') });
    // Alice votes once; Bob votes twice (his Ballot Broker); Carol once. a: 2, c: 2 — both are exiled.
    let voters: PlayerId[];
    const p0 = resolveUntilVote(g);
    expect(p0.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    expect((p0.pending as { candidates: string[] }).candidates).not.toContain(mine);
    ({ g, voters } = resolve(p0, [a, c, a, c]));
    expect(voters).toEqual(['alice', 'bob', 'bob', 'carol']);
    expect(g.zones.battlefield.includes(a)).toBe(false);
    expect(g.zones.battlefield.includes(c)).toBe(false);
    expect(g.zones.battlefield.includes(mine)).toBe(true);
  });

  it('secret council: votes are revealed after everyone has voted; "equal to the number of truth votes"', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Truth Game', 'hand') });
    const { g: after } = resolve(g, ['truth', 'consequences', 'truth']);
    expect(after.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('"For each time vote, take an extra turn after this one."', () => {
    let g = toStep(start({ extra: CARDS, players: 2 }), 'main1', 'alice');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Time Vote', 'hand') });
    const { g: after } = resolve(g, ['time', 'time']);
    expect(after.extraTurns).toEqual(['alice', 'alice']);
  });
});

function resolveUntilVote(g: GameState): GameState {
  for (let guard = 0; guard < 20 && !g.pending; guard++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

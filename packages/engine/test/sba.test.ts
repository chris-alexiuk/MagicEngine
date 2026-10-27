import { describe, expect, it } from 'vitest';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

describe('state-based actions', () => {
  it('CR 704.5a / CR 104.2a: a player at 0 life loses; the last player standing wins', () => {
    let g = toStep(start(), 'main1');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'life', target: 'bob', delta: -20 } });
    expect(g.players.bob!.lost).toBe(true);
    expect(g).toMatchObject({ over: true, winner: 'alice' });
  });

  it('CR 704.5b: a player who drew from an empty library loses', () => {
    let g = start();
    g.zones.library.bob = [];
    g = toStep(g, 'upkeep', 'bob');
    g = passRound(g);
    expect(g.players.bob!.lost).toBe(true);
    expect(g.winner).toBe('alice');
  });

  it('CR 704.5c: ten poison counters loses', () => {
    let g = toStep(start(), 'main1');
    g.players.bob!.poison = 10;
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.players.bob!.lost).toBe(true);
  });

  it('CR 704.5f / CR 704.5q: -1/-1 counters cancel +1/+1 counters; toughness 0 dies', () => {
    let g = toStep(start(), 'main1');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'counters', object: bears, counter: '+1/+1', delta: 1 } });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'counters', object: bears, counter: '-1/-1', delta: 2 } });
    expect(g.objects[bears]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 0, '-1/-1': 1 } });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'counters', object: bears, counter: '-1/-1', delta: 1 } });
    expect(g.objects[bears]!.zone).toBe('graveyard');
  });

  it('CR 704.5g / CR 702.12b: lethal damage destroys a creature unless it is indestructible', () => {
    let g = toStep(start(), 'main1');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[bears]!.damage = 2;
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.objects[bears]!.zone).toBe('graveyard');
  });

  it('CR 704.5j: with two legendary permanents of the same name, the controller keeps one', () => {
    let g = toStep(start(), 'main1');
    const a = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield');
    const b = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending).toEqual({ kind: 'legend_rule', player: 'alice', name: 'Kinnan, Bonder Prodigy', objects: [a, b] });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'legend_rule', keep: 'nope' } })).toMatch(/keep/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'legend_rule', keep: b } });
    expect(g.objects[a]!.zone).toBe('graveyard');
    expect(g.objects[b]!.zone).toBe('battlefield');
    expect(g.priority).toBe('bob');
  });

  it('CR 704.5j: the legend rule doesn’t apply across different controllers', () => {
    let g = toStep(start(), 'main1');
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield');
    give(g, 'bob', 'Kinnan, Bonder Prodigy', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending).toBeNull();
  });

  it('CR 704.5d: a token that leaves the battlefield ceases to exist', () => {
    let g = toStep(start(), 'main1');
    const token = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[token]!.token = true;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: token, to: 'graveyard' } });
    expect(g.objects[token]).toBeUndefined();
    expect(g.zones.graveyard.alice).toEqual([]);
  });
});

describe('leaving the game', () => {
  it('CR 104.3a: a player can concede at any time, even without priority', () => {
    let g = start();
    expect(g.priority).toBe('alice');
    g = act(g, { type: 'concede', player: 'bob' });
    expect(g).toMatchObject({ over: true, winner: 'alice' });
  });

  it('CR 800.4a: in multiplayer the game continues; the leaver’s cards leave with them', () => {
    let g = toStep(start({ players: 3 }), 'main1');
    const bobsBears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    g = act(g, { type: 'concede', player: 'bob' });
    expect(g.over).toBe(false);
    expect(g.objects[bobsBears]).toBeUndefined();
    expect(g.zones.hand.bob).toEqual([]);
    // Priority moves on to the next player still in the game.
    expect(g.priority).toBe('carol');
    g = act(g, { type: 'pass', player: 'carol' });
    expect(g.step).toBe('beginning_of_combat');
  });
});

describe('planeswalkers', () => {
  it('CR 306.5b / CR 606.4 / CR 606.3 / CR 606.6: loyalty counters, once per turn, and no going below zero', () => {
    let g = toStep(start(), 'main1');
    for (let i = 0; i < 4; i++) give(g, 'alice', 'Island', 'battlefield');
    g.cards.Island = { ...g.cards.Forest!, name: 'Island', faces: [{ ...g.cards.Forest!.faces[0]!, name: 'Island', subtypes: ['Island'] }] };
    const jace = give(g, 'alice', 'Jace, the Mind Sculptor', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: jace, autoTap: true });
    g = passRound(g);
    expect(g.objects[jace]!.counters.loyalty).toBe(3);

    // Unparsed lines (resolved by hand): +2, 0 and −12. "−1: Return target creature…" compiles.
    const plusTwo = 0;
    const minusTwelve = 2;
    expect(illegal(g, { type: 'activate_manual', player: 'alice', object: jace, line: minusTwelve })).toMatch(/enough loyalty/);
    g = act(g, { type: 'activate_manual', player: 'alice', object: jace, line: plusTwo });
    expect(g.objects[jace]!.counters.loyalty).toBe(5);
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Jace, the Mind Sculptor' }]);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'manual_resolution', done: true } });
    expect(illegal(g, { type: 'activate_manual', player: 'alice', object: jace, line: 1 })).toMatch(/already activated/);
    // The once-per-turn limit covers compiled loyalty abilities too.
    expect(illegal(g, { type: 'activate', player: 'alice', object: jace, ability: 0, targets: [[]] })).toMatch(/already activated/);
  });

  it('CR 704.5i: a planeswalker with no loyalty goes to the graveyard', () => {
    let g = toStep(start(), 'main1');
    const jace = give(g, 'alice', 'Jace, the Mind Sculptor', 'battlefield');
    g.objects[jace]!.counters.loyalty = 1;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'counters', object: jace, counter: 'loyalty', delta: -1 } });
    expect(g.objects[jace]!.zone).toBe('graveyard');
  });
});

describe('abilities the compiler couldn’t parse', () => {
  it('CR 602.2: they can be activated by paying their mana cost, then resolved by hand', () => {
    // A line the grammar won't read any time soon.
    const odd = makeCard({ name: 'Odd Engine', type_line: 'Artifact', mana_cost: '{2}', oracle_text: "{5}{G}{U}: Put the top card of your library onto the battlefield if its name has an odd number of letters." });
    let g = toStep(start({ extra: [odd] }), 'main1');
    const engine = give(g, 'alice', 'Odd Engine', 'battlefield');
    for (let i = 0; i < 6; i++) give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Breeding Pool', 'battlefield');
    g = act(g, { type: 'activate_manual', player: 'alice', object: engine, line: 0, autoTap: true });
    expect(g.stack).toMatchObject([{ kind: 'ability', controller: 'alice' }]);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.tapped)).toHaveLength(7);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', sourceName: 'Odd Engine' });
    // While resolving, the player makes the moves the text describes.
    const top = g.zones.library.alice![0]!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: top, to: 'battlefield' } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'manual_resolution', done: true } });
    expect(g.objects[top]!.zone).toBe('battlefield');
    expect(g.stack).toEqual([]);
  });

  it('rejects lines that aren’t activated abilities', () => {
    const g = toStep(start(), 'main1');
    const kinnan = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield');
    expect(illegal(g, { type: 'activate_manual', player: 'alice', object: kinnan, line: 0 })).toMatch(/isn’t an activated ability/);
  });
});

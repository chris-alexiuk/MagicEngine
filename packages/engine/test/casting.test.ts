import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

function withLands(names: string[]) {
  const g = toStep(start(), 'main1');
  const lands = names.map((n) => give(g, 'alice', n, 'battlefield'));
  return { g, lands };
}

describe('casting spells', () => {
  it('CR 117.1a: a creature only during your main phase with an empty stack', () => {
    let g = start();
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    expect(g.step).toBe('upkeep');
    expect(illegal(g, { type: 'cast', player: 'alice', object: bears, autoTap: true })).toMatch(/main phase/);
    g = toStep(g, 'main1');
    g = act(g, { type: 'cast', player: 'alice', object: bears, autoTap: true });
    expect(g.stack).toHaveLength(1);
  });

  it('CR 117.1a: an instant any time you have priority, even on another player’s turn', () => {
    let g = start();
    const bolt = give(g, 'bob', 'Lightning Bolt', 'hand');
    const mountain = makeCard({ name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' });
    g.cards.Mountain = mountain;
    give(g, 'bob', 'Mountain', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    g = act(g, { type: 'cast', player: 'bob', object: bolt, autoTap: true });
    expect(g.stack).toMatchObject([{ kind: 'spell', object: bolt, controller: 'bob' }]);
  });

  it('CR 702.8a: flash lets a creature be cast at instant speed', () => {
    const flashy = makeCard({ name: 'Flash Bear', type_line: 'Creature — Bear', mana_cost: '{G}', oracle_text: 'Flash', power: '2', toughness: '2' });
    let g = start({ extra: [flashy] });
    const bear = give(g, 'bob', 'Flash Bear', 'hand');
    give(g, 'bob', 'Forest', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: bear, autoTap: true });
    expect(g.stack).toHaveLength(1);
  });

  it('CR 601.2a / CR 601.2h / CR 601.2i: the spell moves to the stack, its cost is paid, and its caster keeps priority', () => {
    let { g, lands } = withLands(['Forest', 'Forest']);
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    for (const land of lands) g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 0 });
    g = act(g, { type: 'cast', player: 'alice', object: bears });
    expect(g.objects[bears]!.zone).toBe('stack');
    expect(g.players.alice!.pool.G).toBe(0);
    expect(g.priority).toBe('alice');
  });

  it('CR 601.2h / CR 733.1: without enough mana the cast is illegal and nothing changes', () => {
    const { g } = withLands(['Forest']);
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    const before = structuredClone(g);
    expect(illegal(g, { type: 'cast', player: 'alice', object: bears, autoTap: true })).toMatch(/untapped mana/);
    expect(g).toEqual(before);
  });

  it('CR 601.2g: mana abilities can be activated automatically while casting', () => {
    let { g, lands } = withLands(['Forest', 'Thornwood Falls', 'Sol Ring']);
    g.objects[lands[1]!]!.tapped = false;
    const kinnan = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: kinnan, autoTap: true });
    // Kinnan costs {G}{U}: the Forest pays green, the Falls must pay blue, Sol Ring stays untapped.
    expect(lands.map((id) => g.objects[id]!.tapped)).toEqual([true, true, false]);
  });

  it('CR 117.4 / CR 608.3a / CR 117.3b: after all pass, a creature spell resolves onto the battlefield and the active player gets priority', () => {
    let { g } = withLands(['Forest', 'Forest']);
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bears, autoTap: true });
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.stack).toHaveLength(1);
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.stack).toHaveLength(0);
    expect(g.objects[bears]).toMatchObject({ zone: 'battlefield', controller: 'alice', sick: true });
    expect(g.priority).toBe('alice');
    expect(g.step).toBe('main1');
  });

  it('CR 608.2n: an instant the engine can’t run is resolved by hand, then goes to the graveyard', () => {
    let { g } = withLands(['Forest', 'Forest']);
    const spell = give(g, 'alice', 'Counterspell', 'hand');
    g.cards.Counterspell = { ...g.cards.Counterspell!, faces: [{ ...g.cards.Counterspell!.faces[0]!, manaCost: '{G}{G}' }] };
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', player: 'alice', text: 'Counter target spell.' });
    expect(illegal(g, { type: 'pass', player: 'bob' })).toMatch(/Waiting for Alice/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'manual_resolution', done: true } });
    expect(g.objects[spell]!.zone).toBe('graveyard');
    expect(g.stack).toEqual([]);
    expect(g.priority).toBe('alice');
  });

  it('CR 709.3: a split card is cast as the half the player chooses', () => {
    let { g } = withLands(['Breeding Pool', 'Breeding Pool']);
    const fireIce = give(g, 'alice', 'Fire // Ice', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: fireIce, face: 1, autoTap: true });
    expect(g.objects[fireIce]!.face).toBe(1);
  });

  it('CR 712.11: a transforming double-faced card is cast front face up', () => {
    const { g } = withLands(['Island']);
    g.cards.Island = makeCard({ name: 'Island', type_line: 'Basic Land — Island' });
    const delver = give(g, 'alice', 'Delver of Secrets // Insectile Aberration', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: delver, face: 1 })).toMatch(/can’t be cast/);
  });

  it('casts with {X} using the announced value', () => {
    const blaze = makeCard({ name: 'Blaze', type_line: 'Sorcery', mana_cost: '{X}{G}', oracle_text: 'Blaze deals X damage to any target.' });
    let g = toStep(start({ extra: [blaze] }), 'main1');
    for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
    const spell = give(g, 'alice', 'Blaze', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: spell, x: 3, autoTap: true });
    expect(g.stack).toMatchObject([{ kind: 'spell', x: 3 }]);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.tapped)).toHaveLength(4);
  });

  it('lists legal actions for the UI', () => {
    const { g } = withLands(['Forest', 'Forest']);
    give(g, 'alice', 'Grizzly Bears', 'hand');
    give(g, 'alice', 'Serra Angel', 'hand');
    const kinds = legalActions(g, 'alice').map((a) => (a.type === 'cast' ? `cast ${g.objects[a.object]!.card}` : a.type));
    expect(kinds).toContain('cast Grizzly Bears');
    expect(kinds).not.toContain('cast Serra Angel');
    expect(kinds).toContain('play_land');
    expect(legalActions(g, 'bob')).toEqual([]);
  });
});

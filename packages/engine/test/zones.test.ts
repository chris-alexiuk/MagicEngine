import { describe, expect, it } from 'vitest';
import { act, give, start, toStep } from './helpers.js';

describe('zones', () => {
  it('CR 400.7: an object that changes zones becomes a new object with no memory of the old one', () => {
    let g = toStep(start(), 'main1');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[bears]!.tapped = true;
    g.objects[bears]!.counters['+1/+1'] = 2;
    const before = g.objects[bears]!.zcc;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'hand' } });
    expect(g.objects[bears]).toMatchObject({ zone: 'hand', tapped: false, counters: {}, zcc: before + 1 });
  });

  it('CR 108.3 / CR 401.1: each player owns the cards they started with, which form their library', () => {
    const g = start({ mulligan: true });
    for (const id of [...g.zones.library.bob!, ...g.zones.hand.bob!]) expect(g.objects[id]!.owner).toBe('bob');
  });

  it('CR 400.3: a card always goes to its owner’s graveyard', () => {
    let g = toStep(start(), 'main1');
    const bobsBears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.objects[bobsBears]!.controller = 'alice';
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bobsBears, to: 'graveyard' } });
    expect(g.zones.graveyard.bob).toEqual([bobsBears]);
    expect(g.zones.graveyard.alice).toEqual([]);
  });

  it('library moves go to the top unless asked for the bottom', () => {
    let g = toStep(start(), 'main1');
    const [a, b] = g.zones.hand.alice!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: a!, to: 'library' } });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: b!, to: 'library', position: 'bottom' } });
    expect(g.zones.library.alice![0]).toBe(a);
    expect(g.zones.library.alice!.at(-1)).toBe(b);
  });
});

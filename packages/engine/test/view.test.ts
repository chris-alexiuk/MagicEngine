import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/index.js';
import { give, start, toStep } from './helpers.js';

describe('player views (hidden information)', () => {
  it('shows your own hand, only counts for other hands and every library', () => {
    const g = toStep(start(), 'main1');
    const secret = give(g, 'bob', 'Rhystic Study', 'hand');
    const v = viewFor(g, 'alice');
    expect(v.zones.hand.alice).toEqual(g.zones.hand.alice);
    expect(v.zones.hand.bob).toBe(g.zones.hand.bob!.length);
    expect(v.zones.library).toEqual({ alice: g.zones.library.alice!.length, bob: g.zones.library.bob!.length });
    expect(v.objects[secret]).toBeUndefined();
    expect(v.cards['Rhystic Study']).toBeUndefined();
    expect('rng' in v).toBe(false);
  });

  it('shows public zones to everyone', () => {
    const g = toStep(start(), 'main1');
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    expect(viewFor(g, 'alice').objects[bears]).toMatchObject({ card: 'Grizzly Bears', zone: 'battlefield' });
  });

  it('hides the details of another player’s pending choice', () => {
    const g = start({ mulligan: true });
    expect(viewFor(g, 'bob').pending).toEqual({ kind: 'mulligan', player: 'alice', hidden: true });
    expect(viewFor(g, 'alice').pending).toEqual({ kind: 'mulligan', player: 'alice' });
  });
});

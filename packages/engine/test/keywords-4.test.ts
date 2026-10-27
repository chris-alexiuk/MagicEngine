import { describe, expect, it } from 'vitest';
import { legalActions, power, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const creature = (name: string, text: string, pt = '2/2', type = 'Creature — Beast') =>
  card(name, type, text, { power: pt.split('/')[0], toughness: pt.split('/')[1] });

const CARDS = [
  creature('Pir', 'Partner with Toothy', '1/1', 'Legendary Creature — Human'),
  creature('Toothy', 'Partner with Pir', '1/1', 'Legendary Creature — Illusion'),
  card('Hero Blade', 'Artifact — Equipment', 'Job select\nEquipped creature gets +1/+1.\nDiana — Equip {2}', { mana_cost: '{1}' }),
  creature('Reinforcer', 'Reinforce 2—{1}{G}'),
  creature('Scavenger', 'Scavenge {1}{G}', '3/3'),
  card('Strive Pump', 'Instant', 'Strive — This spell costs {1}{G} more to cast for each target beyond the first.\nAny number of target creatures each get +1/+1 until end of turn.'),
  creature('Sea Serpent', "This creature can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice this creature.", '5/5', 'Creature — Serpent'),
  card('Crucible', 'Artifact', 'You may play lands from your graveyard.', { mana_cost: '{3}' }),
  card('Ceremony', 'Enchantment', 'Whenever a creature you control enters, if you cast it, destroy that creature, then create a 2/2 black Zombie creature token.', { mana_cost: '{3}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};

describe('slice 22 keywords', () => {
  it('partner with (CR 702.124j): target player may search for the partner', () => {
    let g = setup();
    const toothy = give(g, 'alice', 'Toothy', 'library');
    g.players.alice!.pool.G = 1;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pir', 'hand') }));
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'alice' }]] } });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'search' });
    // (Decks also carry one copy of each test card.)
    if (g.pending?.kind === 'search') expect(g.pending.candidates.every((id) => g.objects[id]!.card === 'Toothy')).toBe(true);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [toothy] } });
    expect(g.objects[toothy]!.zone).toBe('hand');
  });

  it('job select (CR 702.182a) and a flavor word before equip', () => {
    let g = setup();
    g.players.alice!.pool.C = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hero Blade', 'hand') })));
    const hero = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect(power(g, g.objects[hero]!)).toBe(2);
    const blade = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Hero Blade')!;
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === blade)).toBe(false); // no mana yet
    g.players.alice!.pool.C = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === blade)).toBe(true);
  });

  it('reinforce (CR 702.77a) from the hand; scavenge (CR 702.97a) from the graveyard', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const r = give(g, 'alice', 'Reinforcer', 'hand');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: r, ability: 0, targets: [[obj(bears)]] }));
    expect(g.objects[bears]!.counters['+1/+1']).toBe(2);
    expect(g.objects[r]!.zone).toBe('graveyard');
    const s = give(g, 'alice', 'Scavenger', 'graveyard');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: s, ability: 0, targets: [[obj(bears)]] }));
    expect(g.objects[bears]!.counters['+1/+1']).toBe(5);
  });

  it('strive: more for each target beyond the first', () => {
    let g = setup();
    const a = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Strive Pump', 'hand');
    g.players.alice!.pool.G = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(a), obj(b)]] })).toMatch(/mana/i);
    g.players.alice!.pool.G = 2;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(a), obj(b)]] }));
    expect(power(g, g.objects[a]!)).toBe(3);
    expect(power(g, g.objects[b]!)).toBe(3);
  });

  it('sea serpents: can’t attack unless the defender controls an Island; sacrificed with no Islands (CR 603.8)', () => {
    let g = setup();
    give(g, 'alice', 'Island', 'battlefield');
    const serpent = give(g, 'alice', 'Sea Serpent', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: serpent, target: bob }] } })).toMatch(/Island/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } });
    const island = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Island')!;
    g.zones.battlefield.splice(g.zones.battlefield.indexOf(island), 1);
    g.objects[island]!.zone = 'graveyard';
    g.zones.graveyard.alice!.push(island);
    g = toStep(g, 'main2');
    g = settle(g);
    expect(g.objects[serpent]!.zone).toBe('graveyard');
  });

  it('“You may play lands from your graveyard.”', () => {
    let g = setup();
    give(g, 'alice', 'Crucible', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'graveyard');
    expect(legalActions(g, 'alice')).toContainEqual({ type: 'play_land', player: 'alice', object: forest });
    g = act(g, { type: 'play_land', player: 'alice', object: forest });
    expect(g.objects[forest]!.zone).toBe('battlefield');
  });

  it('“if you cast it” is about the creature that entered, not the source (a token isn’t cast)', () => {
    let g = setup();
    give(g, 'alice', 'Ceremony', 'battlefield');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grizzly Bears', 'hand') })));
    const tokens = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(tokens).toHaveLength(1);
    expect(g.stack).toHaveLength(0);
  });
});

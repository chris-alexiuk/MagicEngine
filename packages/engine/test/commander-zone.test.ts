import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const partner = makeCard({ name: 'Partner Wizard', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{U}', power: '1', toughness: '1', oracle_text: 'Partner' });
const partner2 = makeCard({ name: 'Partner Rogue', type_line: 'Legendary Creature — Human Rogue', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: 'Partner' });
const evoker = makeCard({ name: 'Evoke Elemental', type_line: 'Legendary Creature — Elemental', mana_cost: '{4}{G}', power: '3', toughness: '3', oracle_text: 'Evoke {G}' });

const forests = Array.from({ length: 40 }, () => 'Forest');

function game(commanders: string[]): { g: GameState; ids: string[] } {
  const g = toStep(
    start({ format: 'commander', extra: [partner, partner2, evoker], decks: { alice: [...forests.slice(commanders.length), ...commanders], bob: forests }, commanders: { alice: commanders } }),
    'main1',
  );
  return { g, ids: commanders.map((name) => g.zones.command.find((id) => g.objects[id]!.card === name)!) };
}

const casts = (g: GameState, id: string) => legalActions(g, 'alice').filter((a): a is Extract<Action, { type: 'cast' }> => a.type === 'cast' && a.object === id);
const lands = (g: GameState, n: number, name = 'Breeding Pool') => {
  for (let i = 0; i < n; i++) give(g, 'alice', name, 'battlefield');
};

describe('casting commanders from the command zone (CR 903.8)', () => {
  it('lists the cast once it can be paid, with commander tax counted', () => {
    let { g, ids } = game(['Kinnan, Bonder Prodigy']);
    const kinnan = ids[0]!;
    lands(g, 1);
    expect(casts(g, kinnan)).toEqual([]);
    lands(g, 1);
    expect(casts(g, kinnan)).toEqual([{ type: 'cast', player: 'alice', object: kinnan, autoTap: true }]);
    g = act(g, casts(g, kinnan)[0]!);
    g = passRound(g);
    expect(g.objects[kinnan]!.zone).toBe('battlefield');

    // CR 903.9a: it dies; its owner chooses to put it into the command zone.
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan, to: 'graveyard' } });
    expect(g.pending).toEqual({ kind: 'commander_zone', player: 'alice', object: kinnan, zone: 'graveyard' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'commander_zone', move: true } });
    expect(g.objects[kinnan]!.zone).toBe('command');
    expect(g.priority).toBe('alice');

    // Three untapped lands can't pay {G}{U} plus {2} tax; a fourth can.
    lands(g, 3);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && !g.objects[id]!.tapped)).toHaveLength(3);
    expect(casts(g, kinnan)).toEqual([]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: kinnan, autoTap: true })).toMatch(/enough/);
    lands(g, 1);
    expect(casts(g, kinnan)).toHaveLength(1);
    g = act(g, casts(g, kinnan)[0]!);
    expect(g.commanderCasts[kinnan]).toBe(2);
  });

  it('lists each partner, and an alternative cost with the tax added', () => {
    let { g, ids } = game(['Partner Wizard', 'Partner Rogue', 'Evoke Elemental']);
    lands(g, 1);
    expect(casts(g, ids[0]!)).toHaveLength(1);
    expect(casts(g, ids[1]!)).toHaveLength(1);
    // Evoke {G} from the command zone (CR 118.9 with CR 903.8).
    expect(casts(g, ids[2]!)).toEqual([expect.objectContaining({ alt: 'evoke' })]);
    g = act(g, casts(g, ids[1]!)[0]!);
    g = passRound(g);
    expect(g.objects[ids[1]!]!.zone).toBe('battlefield');
  });

  it('a commander exiled or returned to hand may go to the command zone; declining leaves it there (CR 903.9)', () => {
    let { g, ids } = game(['Kinnan, Bonder Prodigy']);
    const kinnan = ids[0]!;
    lands(g, 2);
    g = passRound(act(g, casts(g, kinnan)[0]!));
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan, to: 'exile' } });
    expect(g.pending).toMatchObject({ kind: 'commander_zone', zone: 'exile' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'commander_zone', move: false } });
    expect(g.objects[kinnan]!.zone).toBe('exile');
    expect(g.pending).toBeNull();
    // Not asked again until it changes zones again.
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending?.kind).not.toBe('commander_zone');

    let h = toStep(start({ format: 'commander', decks: { alice: [...forests.slice(1), 'Kinnan, Bonder Prodigy'], bob: forests }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } }), 'main1');
    const k2 = h.zones.command[0]!;
    lands(h, 2);
    h = passRound(act(h, casts(h, k2)[0]!));
    h = act(h, { type: 'manual', player: 'alice', op: { kind: 'move', object: k2, to: 'hand' } });
    expect(h.pending).toMatchObject({ kind: 'commander_zone', zone: 'hand' });
    // Kept in hand, it's cast from there without tax.
    h = act(h, { type: 'choose', player: 'alice', answer: { kind: 'commander_zone', move: false } });
    expect(h.zones.hand.alice).toContain(k2);
  });

  it('only the owner answers, and only with their commander', () => {
    let { g, ids } = game(['Kinnan, Bonder Prodigy']);
    lands(g, 2);
    g = passRound(act(g, casts(g, ids[0]!)[0]!));
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: ids[0]!, to: 'graveyard' } });
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'commander_zone', move: true } })).toMatch(/no choice/);
    expect(legalActions(g, 'alice')).toEqual([]);
  });
});

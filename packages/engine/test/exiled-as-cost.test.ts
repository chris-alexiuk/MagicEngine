import { describe, expect, it } from 'vitest';
import { chars, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

// CR 607.2a: a card exiled to pay an object's cost is "exiled with" it, and "the exiled card" in the same object's text
// is that card. The link was only made for cards exiled from the battlefield, so Corpse Explosion, Corpse Lunge,
// Draconic Intervention, Necropolis and Dollhouse of Horrors — whose costs exile from a graveyard — did nothing at all.
// (Found by the card sandbox: each "resolved and changed nothing".)

const explosion = makeCard({
  name: 'Corpse Explosion',
  type_line: 'Sorcery',
  mana_cost: '{1}{B}{R}',
  oracle_text: "As an additional cost to cast this spell, exile a creature card from your graveyard.\nCorpse Explosion deals damage equal to the exiled card's power to each creature and each planeswalker.",
});
const lunge = makeCard({
  name: 'Corpse Lunge',
  type_line: 'Instant',
  mana_cost: '{2}{B}',
  oracle_text: "As an additional cost to cast this spell, exile a creature card from your graveyard.\nCorpse Lunge deals damage equal to the exiled card's power to target creature.",
});
const necropolis = makeCard({
  name: 'Necropolis',
  type_line: 'Artifact Creature — Wall',
  mana_cost: '{5}',
  power: '0',
  toughness: '1',
  oracle_text: "Defender (This creature can't attack.)\nExile a creature card from your graveyard: Put X +0/+1 counters on this creature, where X is the exiled card's mana value.",
});
const dollhouse = makeCard({
  name: 'Dollhouse of Horrors',
  type_line: 'Artifact',
  mana_cost: '{5}',
  oracle_text:
    "{1}, {T}, Exile a creature card from your graveyard: Create a token that's a copy of the exiled card, except it's a 0/0 Construct artifact in addition to its other types and it has \"This token gets +1/+1 for each Construct you control.\" It gains haste until end of turn. Activate only as a sorcery.",
});
const extra = [explosion, lunge, necropolis, dollhouse];

function board(): { g: GameState; angel: string; crow: string; dead: string } {
  const g = toStep(start({ extra }), 'main1', 'alice');
  // (Mana of every color in the pool: what pays for them isn't what is being tested.)
  Object.assign(g.players.alice!.pool, { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 });
  return { g, angel: give(g, 'bob', 'Serra Angel', 'battlefield'), crow: give(g, 'bob', 'Storm Crow', 'battlefield'), dead: give(g, 'alice', 'Serra Angel', 'graveyard') };
}

describe('CR 607.2a: "the exiled card" is the one a cost exiled from a graveyard', () => {
  it('the cards are read in full', () => {
    expect(extra.map((c) => `${c.name}: ${c.automation}`)).toEqual(['Corpse Explosion: full', 'Corpse Lunge: full', 'Necropolis: full', 'Dollhouse of Horrors: full']);
  });

  it("Corpse Explosion: damage equal to the exiled card's power to each creature", () => {
    const { g: g0, angel, crow, dead } = board();
    const id = give(g0, 'alice', 'Corpse Explosion', 'hand');
    let g = act(g0, { type: 'cast', player: 'alice', object: id, autoTap: true, costs: { exile: [dead] } });
    expect(g.objects[dead]!.zone).toBe('exile');
    g = passRound(g);
    // Serra Angel's power is 4: the 4/4 and the 1/2 both die (CR 704.5g).
    expect(g.objects[angel]!.zone).toBe('graveyard');
    expect(g.objects[crow]!.zone).toBe('graveyard');
  });

  it("Corpse Lunge: the same, to one target", () => {
    const { g: g0, angel, crow, dead } = board();
    const id = give(g0, 'alice', 'Corpse Lunge', 'hand');
    let g = act(g0, { type: 'cast', player: 'alice', object: id, autoTap: true, costs: { exile: [dead] }, targets: [[{ kind: 'object', object: angel }]] });
    g = passRound(g);
    expect(g.objects[angel]!.zone).toBe('graveyard');
    expect(g.objects[crow]!.zone).toBe('battlefield');
  });

  it("Necropolis: X is the mana value of the card exiled to activate it", () => {
    const { g: g0, dead } = board();
    const wall = give(g0, 'alice', 'Necropolis', 'battlefield');
    let g = act(g0, { type: 'activate', player: 'alice', object: wall, ability: 0, costs: { exile: [dead] } });
    g = passRound(g);
    // Serra Angel costs {3}{W}{W}.
    expect(g.objects[wall]!.counters['+0/+1']).toBe(5);
    expect(chars(g, g.objects[wall]!).toughness).toBe(6);
  });

  it('Dollhouse of Horrors: the token is a copy of the card exiled to activate it', () => {
    const { g: g0, dead } = board();
    const house = give(g0, 'alice', 'Dollhouse of Horrors', 'battlefield');
    let g = act(g0, { type: 'activate', player: 'alice', object: house, ability: 0, autoTap: true, costs: { exile: [dead] } });
    g = passRound(g);
    const token = g.zones.battlefield.map((x) => g.objects[x]!).find((o) => o.token);
    expect(token).toBeDefined();
    expect(chars(g, token!).name).toBe('Serra Angel');
    expect(chars(g, token!).subtypes).toContain('Construct');
  });

  it('CR 607.2a: each activation is its own link — the second counts only the card it exiled', () => {
    const { g: g0, dead } = board();
    const wall = give(g0, 'alice', 'Necropolis', 'battlefield');
    const crow = give(g0, 'alice', 'Storm Crow', 'graveyard');
    let g = passRound(act(g0, { type: 'activate', player: 'alice', object: wall, ability: 0, costs: { exile: [crow] } }));
    // Storm Crow costs {1}{U}.
    expect(g.objects[wall]!.counters['+0/+1']).toBe(2);
    g = passRound(act(g, { type: 'activate', player: 'alice', object: wall, ability: 0, costs: { exile: [dead] } }));
    expect(g.objects[wall]!.counters['+0/+1']).toBe(2 + 5);
  });
});

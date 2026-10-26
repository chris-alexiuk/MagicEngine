import { describe, expect, it } from 'vitest';
import type { AttackTarget, GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const creature = (name: string, pt: string, text = '', colors = 'G') =>
  makeCard({
    name,
    type_line: 'Creature — Test',
    mana_cost: `{${colors}}`,
    oracle_text: text,
    power: pt.split('/')[0],
    toughness: pt.split('/')[1],
  });

const EXTRA = [
  creature('Trampler', '5/5', 'Trample'),
  creature('Deathtoucher', '1/1', 'Deathtouch', 'B'),
  creature('Lifelinker', '2/2', 'Lifelink', 'W'),
  creature('Menacer', '3/3', 'Menace', 'R'),
  creature('Double Striker', '2/2', 'Double strike', 'R'),
  creature('Wall', '0/4', 'Defender', 'W'),
  creature('Infector', '1/1', 'Infect', 'B'),
  creature('Reacher', '1/3', 'Reach'),
  creature('Toxic Rat', '1/1', 'Toxic 2', 'B'),
  creature('Forestwalker', '2/2', 'Forestwalk'),
  creature('Ogre', '3/3'),
];

const bob: AttackTarget = { kind: 'player', player: 'bob' };

/** Alice's first main phase with the given creatures ready to attack and Bob's ready to block. */
function setup(alice: string[], bobs: string[] = [], opts: { players?: number; format?: 'commander' | 'constructed' } = {}) {
  let g = toStep(start({ extra: EXTRA, players: opts.players ?? 2, format: opts.format ?? 'constructed' }), 'main1');
  const a = alice.map((n) => give(g, 'alice', n, 'battlefield'));
  const b = bobs.map((n) => give(g, 'bob', n, 'battlefield'));
  return { g, a, b };
}

/** Passes priority until the attack declaration is pending (or the step was skipped). */
function toAttacks(g: GameState): GameState {
  g = toStep(g, 'beginning_of_combat');
  return passRound(g);
}

function attack(g: GameState, attacks: { attacker: string; target?: AttackTarget }[]): GameState {
  return act(g, {
    type: 'choose',
    player: 'alice',
    answer: { kind: 'declare_attackers', attacks: attacks.map((x) => ({ attacker: x.attacker, target: x.target ?? bob })) },
  });
}

function block(g: GameState, player: string, blocks: { blocker: string; attacker: string }[]): GameState {
  return act(g, { type: 'choose', player, answer: { kind: 'declare_blockers', blocks } });
}

describe('declaring attackers', () => {
  it('CR 508.1a / CR 302.6 / CR 702.10b: only untapped creatures controlled since the turn began — or with haste — can attack', () => {
    let { g, a } = setup(['Grizzly Bears']);
    const sick = give(g, 'alice', 'Ogre', 'battlefield', { sick: true });
    const hasty = give(g, 'alice', 'Goblin Guide', 'battlefield', { sick: true });
    g = toAttacks(g);
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', player: 'alice', attackers: [a[0], hasty] });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: sick, target: bob }] } })).toMatch(/can’t attack/);
  });

  it('CR 702.3b: a creature with defender can’t attack', () => {
    let { g } = setup(['Wall']);
    g = toAttacks(g);
    // Nothing could attack, so there's no declaration and blockers/damage are skipped.
    expect(g.pending).toBeNull();
    g = passRound(g);
    expect(g.step).toBe('end_of_combat');
  });

  it('CR 508.1f / CR 702.20b: attacking taps the creature unless it has vigilance', () => {
    let { g, a } = setup(['Grizzly Bears', 'Serra Angel']);
    g = attack(toAttacks(g), [{ attacker: a[0]! }, { attacker: a[1]! }]);
    expect(g.objects[a[0]!]!.tapped).toBe(true);
    expect(g.objects[a[1]!]!.tapped).toBe(false);
    expect(g.priority).toBe('alice');
  });

  it('CR 508.8: declaring no attackers skips straight to the end of combat', () => {
    let { g } = setup(['Grizzly Bears']);
    g = attack(toAttacks(g), []);
    g = passRound(g);
    expect(g.step).toBe('end_of_combat');
  });
});

describe('declaring blockers', () => {
  it('CR 510.1b / CR 120.3a: an unblocked creature damages the player it attacks', () => {
    let { g, a } = setup(['Ogre']);
    g = attack(toAttacks(g), [{ attacker: a[0]! }]);
    g = passRound(g); // declare blockers: Bob has no creatures, so no declaration
    expect(g.step).toBe('declare_blockers');
    g = passRound(g);
    expect(g.step).toBe('combat_damage');
    expect(g.players.bob!.life).toBe(17);
  });

  it('CR 509.1a / CR 510.1c / CR 510.1d / CR 704.5g: blocker and attacker deal damage to each other', () => {
    let { g, a, b } = setup(['Grizzly Bears'], ['Grizzly Bears']);
    g = attack(toAttacks(g), [{ attacker: a[0]! }]);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'declare_blockers', player: 'bob', blockers: [b[0]], attackers: [a[0]] });
    g = block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]);
    expect(g.priority).toBe('alice');
    g = passRound(g);
    expect(g.objects[a[0]!]!.zone).toBe('graveyard');
    expect(g.objects[b[0]!]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(20);
  });

  it('CR 702.9b / CR 702.17b: flying can be blocked only by flying or reach', () => {
    let { g, a, b } = setup(['Serra Angel'], ['Grizzly Bears', 'Reacher']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b[0]!, attacker: a[0]! }] } })).toMatch(/flying/);
    g = block(g, 'bob', [{ blocker: b[1]!, attacker: a[0]! }]);
    expect(g.combat!.attackers[a[0]!]!.blocked).toBe(true);
  });

  it('CR 702.111b: menace needs two or more blockers', () => {
    let { g, a, b } = setup(['Menacer'], ['Grizzly Bears', 'Grizzly Bears']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b[0]!, attacker: a[0]! }] } })).toMatch(/menace/);
    g = block(g, 'bob', [
      { blocker: b[0]!, attacker: a[0]! },
      { blocker: b[1]!, attacker: a[0]! },
    ]);
    expect(g.combat!.attackers[a[0]!]!.blockers).toHaveLength(2);
  });

  it('CR 702.14c: landwalk is unblockable while the defender controls that kind of land', () => {
    let { g, a, b } = setup(['Forestwalker'], ['Grizzly Bears']);
    give(g, 'bob', 'Forest', 'battlefield');
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b[0]!, attacker: a[0]! }] } })).toMatch(/forestwalk/);
  });

  it('CR 702.16f: protection from a color means creatures of that color can’t block it', () => {
    let { g, a, b } = setup(['White Knight'], ['Deathtoucher', 'Grizzly Bears']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b[0]!, attacker: a[0]! }] } })).toMatch(/protection/);
    g = block(g, 'bob', [{ blocker: b[1]!, attacker: a[0]! }]);
    expect(g.combat!.attackers[a[0]!]!.blocked).toBe(true);
  });

  it('CR 509.1a: a blocker blocks only one attacker', () => {
    let { g, a, b } = setup(['Grizzly Bears', 'Ogre'], ['Wall']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }, { attacker: a[1]! }]));
    expect(
      illegal(g, {
        type: 'choose',
        player: 'bob',
        answer: { kind: 'declare_blockers', blocks: [{ blocker: b[0]!, attacker: a[0]! }, { blocker: b[0]!, attacker: a[1]! }] },
      }),
    ).toMatch(/only block one/);
  });
});

describe('combat damage', () => {
  it('CR 702.7b / CR 510.4: first strike deals damage in its own step, before regular damage', () => {
    let { g, a, b } = setup(['White Knight'], ['Grizzly Bears']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    g = block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]);
    g = passRound(g);
    expect(g.step).toBe('combat_damage');
    expect(g.combat!.damageStep).toBe('first');
    expect(g.objects[b[0]!]!.zone).toBe('graveyard');
    g = passRound(g);
    // Second damage step: the dead Bears deal nothing back.
    expect(g.step).toBe('combat_damage');
    expect(g.combat!.damageStep).toBe('regular');
    expect(g.objects[a[0]!]!).toMatchObject({ zone: 'battlefield', damage: 0 });
    g = passRound(g);
    expect(g.step).toBe('end_of_combat');
  });

  it('CR 702.4b: double strike deals damage in both damage steps', () => {
    let { g, a } = setup(['Double Striker']);
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }])));
    expect(g.players.bob!.life).toBe(18);
    g = passRound(g);
    expect(g.players.bob!.life).toBe(16);
  });

  it('CR 702.19b: trample assigns lethal damage to blockers, the rest to the player', () => {
    let { g, a, b } = setup(['Trampler'], ['Grizzly Bears']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    g = block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]);
    g = passRound(g);
    expect(g.pending).toMatchObject({
      kind: 'assign_combat_damage',
      player: 'alice',
      choices: [{ attacker: a[0], power: 5, blockers: [b[0]], trampleTarget: { kind: 'player', player: 'bob' } }],
    });
    const tooLittle = { [a[0]!]: [{ to: { kind: 'permanent' as const, object: b[0]! }, amount: 1 }, { to: { kind: 'player' as const, player: 'bob' }, amount: 4 }] };
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: tooLittle } })).toMatch(/lethal/);
    const suggested = g.pending!.kind === 'assign_combat_damage' ? g.pending!.choices[0]!.suggested : [];
    expect(suggested).toEqual([
      { to: { kind: 'permanent', object: b[0] }, amount: 2 },
      { to: { kind: 'player', player: 'bob' }, amount: 3 },
    ]);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: { [a[0]!]: suggested } } });
    expect(g.players.bob!.life).toBe(17);
    expect(g.objects[b[0]!]!.zone).toBe('graveyard');
  });

  it('CR 510.1c: an attacker with several blockers divides its damage as its controller chooses', () => {
    let { g, a, b } = setup(['Ogre'], ['Grizzly Bears', 'Llanowar Elves']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    g = block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }, { blocker: b[1]!, attacker: a[0]! }]);
    g = passRound(g);
    expect(g.pending?.kind).toBe('assign_combat_damage');
    const toPlayer = { [a[0]!]: [{ to: { kind: 'player' as const, player: 'bob' }, amount: 3 }] };
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: toPlayer } })).toMatch(/only assign damage to its blockers/);
    g = act(g, {
      type: 'choose',
      player: 'alice',
      answer: { kind: 'assign_combat_damage', assignments: { [a[0]!]: [{ to: { kind: 'permanent', object: b[1]! }, amount: 3 }] } },
    });
    expect(g.objects[b[1]!]!.zone).toBe('graveyard');
    expect(g.objects[b[0]!]!.zone).toBe('battlefield');
    // Both blockers still dealt their damage: 2 + 1 = 3 kills the Ogre.
    expect(g.objects[a[0]!]!.zone).toBe('graveyard');
  });

  it('CR 702.2b / CR 704.5h: any damage from deathtouch destroys a creature', () => {
    let { g, a, b } = setup(['Deathtoucher'], ['Serra Angel']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    g = passRound(block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]));
    expect(g.objects[b[0]!]!.zone).toBe('graveyard');
  });

  it('CR 702.16e: damage from a source with the protected-against quality is prevented', () => {
    let { g, a, b } = setup(['Deathtoucher'], ['White Knight']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }]));
    g = passRound(block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]));
    g = passRound(g);
    expect(g.objects[b[0]!]!).toMatchObject({ zone: 'battlefield', damage: 0 });
    expect(g.objects[a[0]!]!.zone).toBe('graveyard');
  });

  it('CR 702.15b / CR 120.3f: lifelink gains its controller that much life', () => {
    let { g, a } = setup(['Lifelinker']);
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }])));
    expect(g.players.alice!.life).toBe(22);
    expect(g.players.bob!.life).toBe(18);
  });

  it('CR 120.3b / CR 120.3d: infect gives poison counters to players and -1/-1 counters to creatures', () => {
    let { g, a, b } = setup(['Infector', 'Infector'], ['Grizzly Bears']);
    g = passRound(attack(toAttacks(g), [{ attacker: a[0]! }, { attacker: a[1]! }]));
    g = passRound(block(g, 'bob', [{ blocker: b[0]!, attacker: a[0]! }]));
    expect(g.players.bob!).toMatchObject({ life: 20, poison: 1 });
    expect(g.objects[b[0]!]!.counters['-1/-1']).toBe(1);
  });

  it('CR 702.164c: toxic adds poison counters on combat damage to a player', () => {
    let { g, a } = setup(['Toxic Rat']);
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }])));
    expect(g.players.bob!).toMatchObject({ life: 19, poison: 2 });
  });

  it('CR 120.3c: damage to a planeswalker removes loyalty counters', () => {
    let { g, a } = setup(['Ogre']);
    const jace = give(g, 'bob', 'Jace, the Mind Sculptor', 'battlefield');
    g.objects[jace]!.counters.loyalty = 5;
    g = toAttacks(g);
    expect(g.pending).toMatchObject({ targets: [bob, { kind: 'planeswalker', object: jace }] });
    g = passRound(passRound(attack(g, [{ attacker: a[0]!, target: { kind: 'planeswalker', object: jace } }])));
    expect(g.objects[jace]!.counters.loyalty).toBe(2);
    expect(g.players.bob!.life).toBe(20);
  });

  it('CR 506.4: a creature that leaves the battlefield is removed from combat and deals no damage', () => {
    let { g, a } = setup(['Ogre']);
    g = attack(toAttacks(g), [{ attacker: a[0]! }]);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: a[0]!, to: 'hand' } });
    g = passRound(g);
    expect(g.step).toBe('declare_blockers');
    g = passRound(g);
    expect(g.players.bob!.life).toBe(20);
  });

  it('CR 511.3: combat is over once the end of combat step ends', () => {
    let { g, a } = setup(['Ogre']);
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }])));
    g = passRound(g);
    expect(g.step).toBe('end_of_combat');
    expect(g.combat).not.toBeNull();
    g = passRound(g);
    expect(g.step).toBe('main2');
    expect(g.combat).toBeNull();
  });
});

describe('multiplayer combat', () => {
  it('CR 802.3 / CR 802.4: attack several opponents; each declares blockers in APNAP order', () => {
    let { g, a } = setup(['Ogre', 'Grizzly Bears'], [], { players: 3 });
    const bobBlocker = give(g, 'bob', 'Wall', 'battlefield');
    const carolBlocker = give(g, 'carol', 'Wall', 'battlefield');
    g = toAttacks(g);
    g = attack(g, [{ attacker: a[0]!, target: bob }, { attacker: a[1]!, target: { kind: 'player', player: 'carol' } }]);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'declare_blockers', player: 'bob', attackers: [a[0]] });
    expect(
      illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: bobBlocker, attacker: a[1]! }] } }),
    ).toMatch(/attacking you/);
    g = block(g, 'bob', []);
    expect(g.pending).toMatchObject({ kind: 'declare_blockers', player: 'carol', attackers: [a[1]] });
    g = block(g, 'carol', [{ blocker: carolBlocker, attacker: a[1]! }]);
    g = passRound(g);
    expect(g.players.bob!.life).toBe(17);
    expect(g.players.carol!.life).toBe(20);
  });
});

describe('Commander', () => {
  const deck = [...Array.from({ length: 39 }, () => 'Forest'), 'Kinnan, Bonder Prodigy'];
  const forests = Array.from({ length: 40 }, () => 'Forest');

  it('CR 903.6 / CR 903.8: commanders start in the command zone and cost {2} more for each previous cast', () => {
    let g = start({ format: 'commander', decks: { alice: deck, bob: forests }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } });
    const [kinnan] = g.zones.command;
    expect(g.objects[kinnan!]).toMatchObject({ card: 'Kinnan, Bonder Prodigy', commander: true, zone: 'command' });
    expect(g.zones.library.alice!.length + g.zones.hand.alice!.length).toBe(39);

    g = toStep(g, 'main1');
    give(g, 'alice', 'Breeding Pool', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: kinnan!, autoTap: true });
    g = passRound(g);
    expect(g.objects[kinnan!]!.zone).toBe('battlefield');

    // Back to the command zone (returning automatically arrives with the rest of rule 903.9).
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan!, to: 'command' } });
    give(g, 'alice', 'Breeding Pool', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: kinnan!, autoTap: true })).toMatch(/enough/);
    give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: kinnan!, autoTap: true });
    expect(g.commanderCasts[kinnan!]).toBe(2);
  });

  it('CR 903.10a / CR 704.6c: 21 combat damage from one commander loses the game', () => {
    let { g, a } = setup(['Kinnan, Bonder Prodigy'], [], { format: 'commander' });
    g.objects[a[0]!]!.commander = true;
    g.commanderDamage.bob = { [a[0]!]: 19 };
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }])));
    expect(g.players.bob!.life).toBe(38);
    expect(g.players.bob!.lost).toBe(true);
    expect(g.winner).toBe('alice');
  });

  it('commander damage counts only combat damage from that commander', () => {
    let { g, a } = setup(['Kinnan, Bonder Prodigy', 'Ogre'], [], { format: 'commander' });
    g.objects[a[0]!]!.commander = true;
    g = passRound(passRound(attack(toAttacks(g), [{ attacker: a[0]! }, { attacker: a[1]! }])));
    expect(g.commanderDamage.bob).toEqual({ [a[0]!]: 2 });
  });
});

import { describe, expect, it } from 'vitest';
import { hasKeyword, viewFor } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Bounty', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'For each land you control, create a Treasure token.' }),
  makeCard({ name: 'Koma, Cosmos Serpent', type_line: 'Legendary Creature — Serpent', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil." }),
  makeCard({ name: 'Mercy', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature deals damage to you, destroy it.' }),
  makeCard({ name: 'Haliya', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "At the beginning of your end step, draw a card if you've gained 3 or more life this turn." }),
  makeCard({ name: 'Heal', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Small Heal', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 2 life.' }),
  makeCard({ name: 'Trisk', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'At the beginning of your upkeep, if you have exactly thirteen cards in your hand, you win the game.' }),
  makeCard({ name: 'Wave', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Return each creature without a +1/+1 counter on it to its owner's hand." }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Impetus', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nWhenever enchanted creature attacks, you create a Treasure token.' }),
  makeCard({ name: 'Heritage', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.' }),
  makeCard({ name: 'Elixir', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{2}, {T}: You gain 5 life. Shuffle this artifact and your graveyard into their owner's library." }),
  makeCard({ name: 'Endurance', type_line: 'Creature — Elemental Incarnation', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'Flash\nReach\nWhen this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.' }),
  makeCard({ name: 'Gate', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Prevent all combat damage that would be dealt to attacking creatures you control.' }),
  makeCard({ name: 'Chasm', type_line: 'Land', mana_cost: '', oracle_text: 'Prevent all damage that would be dealt to you.' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Windbrisk', type_line: 'Land', mana_cost: '', oracle_text: 'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {W}.\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.' }),
  makeCard({ name: 'Spinerock', type_line: 'Land', mana_cost: '', oracle_text: 'Hideaway 4\nThis land enters tapped.\n{T}: Add {R}.\n{R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.' }),
  makeCard({ name: 'Blast', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Blast deals 7 damage to target player.' }),
  makeCard({ name: 'Big Spell', type_line: 'Sorcery', mana_cost: '{7}', cmc: 7, oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Watcher', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "Hideaway 4\nWhen this creature leaves the battlefield, put the exiled card into its owner's hand." }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Ascension', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each end step, if an opponent lost 2 or more life this turn, you may put a quest counter on this enchantment.\nWhenever a card is put into an opponent's graveyard from anywhere, if this enchantment has three or more quest counters on it, you may have that player lose 2 life. If you do, you gain 2 life." }),
  makeCard({ name: 'Mill', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills a card.' }),
  makeCard({ name: 'Drain', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent loses 3 life.' }),
  makeCard({ name: 'Storm Rally', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn.' }),
  makeCard({ name: 'Flare', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Until end of turn, your life total can't change, and permanents you control gain hexproof and indestructible." }),
  makeCard({ name: 'Hailfire', type_line: 'Sorcery', mana_cost: '{X}{B}{B}', cmc: 2, colors: ['B'], color_identity: ['B'], oracle_text: 'Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.' }),
  makeCard({ name: 'Wishclaw', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'This artifact enters with three wish counters on it.\n{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.' }),
  makeCard({ name: 'Ghostform', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature or planeswalker you control\nWhen enchanted permanent dies or is put into exile, return that card to the battlefield under your control.' }),
  makeCard({ name: 'Sphere', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control." }),
  makeCard({ name: 'Breach', type_line: 'Instant — Arcane', mana_cost: '{0}', oracle_text: 'You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice that creature at the beginning of the next end step.' }),
  makeCard({ name: 'Neheb', type_line: 'Legendary Creature — Zombie Warrior', mana_cost: '{0}', power: '4', toughness: '6', oracle_text: 'At the beginning of your postcombat main phase, add {R} for each 1 life your opponents have lost this turn.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const tokens = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
/** Through the rest of combat with no blocks (or the given ones). */
function finishCombat(g: GameState, defender: string, blocks: { blocker: string; attacker: string }[] = []): GameState {
  for (let i = 0; i < 40 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: defender, answer: { kind: 'declare_blockers', blocks } } as never);
    else if (g.pending) break;
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
}

describe('staples (slice 160)', () => {
  it("Brass's Bounty: a Treasure for each land you control", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'bob', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bounty', 'hand') }));
    expect(tokens(g, 'alice')).toHaveLength(3);
  });

  it("Koma: Koma's Coil, by name", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'bob'));
    const [coil] = tokens(g, 'alice');
    expect(g.cards[g.objects[coil!]!.card]!.name).toBe("Koma's Coil");
  });

  it('No Mercy destroys a creature that deals damage to you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Mercy', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } });
    g = finishCombat(g, 'alice');
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it("Haliya: a card at the end step if you've gained 3 or more life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Haliya', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Small Heal', 'hand') }));
    let hand = g.zones.hand.alice!.length;
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Small Heal', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Small Heal', 'hand') }));
    hand = g.zones.hand.alice!.length;
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Triskaidekaphile: exactly thirteen cards in hand wins', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Trisk', 'battlefield');
    // Alice draws one in her draw step, after the upkeep check.
    while (g.zones.hand.alice!.length < 13) give(g, 'alice', 'Bear', 'hand');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.players.bob!.lost).toBe(true);
  });

  it('Wave Goodbye spares creatures with a +1/+1 counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const keep = give(g, 'bob', 'Bear', 'battlefield');
    g.objects[keep]!.counters['+1/+1'] = 1;
    const gone = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wave', 'hand') }));
    expect(g.objects[keep]!.zone).toBe('battlefield');
    expect(g.objects[gone]!.zone).toBe('hand');
  });

  it('Shiny Impetus: goaded by the Aura’s controller; a Treasure when it attacks', () => {
    let g = start({ extra: CARDS, players: 3 });
    g = toStep(g, 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Impetus', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g.clock++;
    g = toAttack(toStep(g, 'beginning_of_combat', 'bob'));
    expect(g.pending?.kind).toBe('declare_attackers');
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [] } })).toMatch(/goaded/);
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } })).toMatch(/goaded/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'carol' } }] } });
    g = settle(g);
    expect(tokens(g, 'alice')).toHaveLength(1);
  });

  it("Duelist's Heritage triggers on anyone's attack", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Heritage', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'may'; i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending?.kind).toBe('may');
    expect(g.pending?.player).toBe('alice');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(hasKeyword(g, g.objects[bear]!, 'double_strike')).toBe(true);
  });

  it('Elixir of Immortality: 5 life, then it and your graveyard into your library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elixir = give(g, 'alice', 'Elixir', 'battlefield');
    const dead = give(g, 'alice', 'Bear', 'graveyard');
    const library = g.zones.library.alice!.length;
    const life = g.players.alice!.life;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: elixir, ability: 0 }));
    expect(g.players.alice!.life).toBe(life + 5);
    expect(g.zones.graveyard.alice).toHaveLength(0);
    expect(g.zones.library.alice!.length).toBe(library + 2);
    expect(g.zones.library.alice).toContain(elixir);
    expect(g.zones.library.alice).toContain(dead);
  });

  it("Endurance: a player's graveyard to the bottom of their library; or no one", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'bob', 'Bear', 'graveyard');
    const b = give(g, 'bob', 'Wall', 'graveyard');
    const mine = give(g, 'alice', 'Bear', 'graveyard');
    const top = g.zones.library.bob![0];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Endurance', 'hand') });
    g = settle(g);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }));
    expect(g.zones.graveyard.bob).toHaveLength(0);
    expect(g.zones.library.bob![0]).toBe(top);
    expect(g.zones.library.bob!.slice(-2).sort()).toEqual([a, b].sort());
    expect(g.objects[mine]!.zone).toBe('graveyard');
    // Up to one: no target at all.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Endurance', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[]] } }));
    expect(g.objects[mine]!.zone).toBe('graveyard');
  });

  it('Dolmen Gate: no combat damage to your attackers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Gate', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    g = finishCombat(g, 'bob', [{ blocker: wall, attacker: bear }]);
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.damage).toBe(0);
    expect(g.objects[wall]!.damage).toBe(2);
  });

  it('Glacial Chasm: all damage to you is prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Chasm', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(life);
  });

  it('Hideaway: exiled face down (hidden from others), played free once the condition holds', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const spell = give(g, 'alice', 'Big Spell', 'library');
    lib.splice(lib.indexOf(spell), 1);
    lib.unshift(spell);
    const top4 = lib.slice(0, 4);
    const land = give(g, 'alice', 'Windbrisk', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: land }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [spell] } }));
    expect(g.objects[spell]!.zone).toBe('exile');
    expect(g.objects[land]!.tapped).toBe(true);
    // The rest went to the bottom.
    for (const id of top4.filter((id) => id !== spell)) expect(g.zones.library.alice!.slice(-3)).toContain(id);
    expect(viewFor(g, 'bob').objects[spell]!.card).not.toBe('Big Spell');
    expect(viewFor(g, 'alice').objects[spell]!.card).toBe('Big Spell');
    // Not yet: no attack this turn.
    g.objects[land]!.tapped = false;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0 }));
    expect(g.pending).toBeFalsy();
    expect(g.objects[spell]!.zone).toBe('exile');
    // Attack with three, then it's free.
    const bears = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'battlefield'));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: bears.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
    g = finishCombat(g, 'bob');
    g = toStep(g, 'main2', 'alice');
    g.objects[land]!.tapped = false;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0 }));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: spell });
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Hideaway: a land is played with a land drop', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const forest = give(g, 'alice', 'Forest', 'library');
    lib.splice(lib.indexOf(forest), 1);
    lib.unshift(forest);
    const land = give(g, 'alice', 'Spinerock', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: land }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [forest] } }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blast', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    // Spinerock was this turn's land: no land play left.
    g.objects[land]!.tapped = false;
    g.players.alice!.pool.R = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0 }));
    expect(g.pending).toBeFalsy();
    expect(g.objects[forest]!.zone).toBe('exile');
    // Next turn, after 7 more damage: played.
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blast', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g.objects[land]!.tapped = false;
    g.players.alice!.pool.R = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0 }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[forest]!.zone).toBe('battlefield');
    expect(g.players.alice!.landsPlayedThisTurn).toBe(1);
  });

  it('Watcher for Tomorrow: the exiled card to hand when it leaves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const watcher = give(g, 'alice', 'Watcher', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: watcher }));
    const exiled = (g.pending as { candidates: string[] }).candidates[2]!;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [exiled] } }));
    expect(g.objects[exiled]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: watcher }]] }));
    expect(g.objects[exiled]!.zone).toBe('hand');
  });

  it('Bloodchief Ascension: quests on life loss; then drains as cards hit opponents’ graveyards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const asc = give(g, 'alice', 'Ascension', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain', 'hand') }));
    g = settle(toStep(g, 'end', 'alice'));
    if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[asc]!.counters.quest).toBe(1);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.objects[asc]!.counters.quest = 3;
    const [me, them] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.players.bob!.life).toBe(them - 2);
    expect(g.players.alice!.life).toBe(me + 2);
    // Alice's own Mill card going to her graveyard doesn't count.
    expect(g.pending).toBeFalsy();
  });

  it("Neheb, the Eternal: {R} for each 1 life opponents lost this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Neheb', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain', 'hand') }));
    g = settle(toStep(g, 'main2', 'alice'));
    expect(g.players.alice!.pool.R).toBe(3);
  });

  it('"until your next turn": flying lasts through the opponent’s turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Storm Rally', 'hand') }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    g = toStep(g, 'main1', 'bob');
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(true);
    g = toStep(g, 'upkeep', 'alice');
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(false);
  });

  it("Flare of Fortitude: your life total can't change; your permanents gain hexproof and indestructible", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const shock = give(g, 'bob', 'Shock', 'hand');
    const life = g.players.alice!.life;
    g = act(g, { type: 'cast', player: 'bob', object: shock, targets: [[{ kind: 'player', player: 'alice' }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Flare', 'hand') }));
    expect(g.players.alice!.life).toBe(life);
    expect(hasKeyword(g, g.objects[bear]!, 'hexproof')).toBe(true);
    expect(hasKeyword(g, g.objects[bear]!, 'indestructible')).toBe(true);
  });

  it('Torment of Hailfire repeats X times', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const life = g.players.bob!.life;
    g.players.alice!.pool.B = 2;
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hailfire', 'hand'), x: 3 }));
    let asked = 0;
    for (let i = 0; i < 10 && g.pending; i++) {
      expect(g.pending.kind).toBe('choose_option');
      const options = (g.pending as { options: string[] }).options;
      g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: options.at(-1)! } }));
      asked++;
    }
    expect(asked).toBe(3);
    expect(g.players.bob!.life).toBe(life - 9);
  });

  it('Wishclaw Talisman: an opponent gains control of it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const claw = give(g, 'alice', 'Wishclaw', 'battlefield');
    g.objects[claw]!.counters.wish = 3;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: claw, ability: 0 }));
    expect(g.pending?.kind).toBe('search');
    const p = g.pending as { candidates: string[] };
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [p.candidates[0]!] } }));
    expect(g.objects[claw]!.controller).toBe('bob');
    expect(g.objects[claw]!.counters.wish).toBe(2);
  });

  it("Kaya's Ghostform: back to the battlefield when it dies or is exiled", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Ghostform', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g.clock++;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });

  it('Sphere of Safety: {X} per attacker, X = enchantments you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Sphere', 'battlefield');
    give(g, 'alice', 'Mercy', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } })).toMatch(/\{2\}/);
  });

  it('Through the Breach: the creature put onto the battlefield gains haste and is sacrificed later', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wall = give(g, 'alice', 'Wall', 'hand');
    const breach = give(g, 'alice', 'Breach', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: breach }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [wall] } });
    g = settle(g);
    expect(g.objects[wall]!.zone).toBe('battlefield');
    expect(hasKeyword(g, g.objects[wall]!, 'haste')).toBe(true);
    expect(g.objects[breach]!.zone).toBe('graveyard');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[wall]!.zone).toBe('graveyard');
  });
});

import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ogre Three', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Vampire Lite', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Warrior Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf Lite', type_line: 'Creature — Elf', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Altar Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice a creature: You gain 1 life.' }),
  makeCard({ name: 'Land Altar Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice a land: You gain 1 life.' }),
  makeCard({ name: 'Peel Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature you control and target creature you don't control to their owners' hands." }),
  makeCard({ name: 'Reverence Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures with power 2 or less can't attack you." }),
  makeCard({ name: 'Statecraft Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all combat damage that would be dealt to and dealt by creatures you control.' }),
  makeCard({ name: 'Resolve Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell if its controller is poisoned.' }),
  makeCard({ name: 'Rushblade Lite', type_line: 'Creature — Azra Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Warriors your team controls have haste.' }),
  makeCard({ name: 'Golden Ratio Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card for each different power among creatures you control.' }),
  makeCard({ name: 'Interpret Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Scry 3, then reveal the top card of your library. Draw cards equal to that card's mana value." }),
  makeCard({ name: 'Judge Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose target attacking or blocking creature. Scry 3, then reveal the top card of your library. Judge Lite deals damage equal to that card's mana value to that creature." }),
  makeCard({ name: 'Imagecrafter Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.' }),
  makeCard({ name: 'Cultivator Lite', type_line: 'Creature — Insect Druid', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, you may discard any number of land cards. Put that many +1/+1 counters on this creature and draw that many cards.' }),
  makeCard({ name: 'Kingpin Lite', type_line: 'Legendary Creature — Human Villain', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever you sacrifice Kingpin Lite or another creature, create two Treasure tokens. This ability triggers only once each turn.' }),
  makeCard({ name: 'Long Feng Lite', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever another creature you control or a land you control is put into a graveyard from the battlefield, put a +1/+1 counter on target creature you control.' }),
  makeCard({ name: 'Web Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nAt the beginning of the end step, if enchanted creature's power is 4 or greater, destroy this Aura." }),
  makeCard({ name: 'Energy Field Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Prevent all damage that would be dealt to you by sources you don't control." }),
  makeCard({ name: 'Naga Lite', type_line: 'Creature — Snake', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'During your turn, prevent all damage that would be dealt to this creature.' }),
  makeCard({ name: 'Gargoyle Lite', type_line: 'Artifact Creature — Gargoyle', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature has flying as long as it's modified." }),
  makeCard({ name: 'Instability Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a land enters, tap all lands its controller controls.' }),
  makeCard({ name: 'Fanatic Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, each player discards a card. If you discarded a card this way, draw a card.' }),
  makeCard({ name: 'Sonar Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Sonar Lite deals 4 damage to target attacking, blocking, or tapped creature. You gain 3 life if you control a Bat.' }),
  makeCard({ name: 'Fangs Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +2/+2 as long as it's a Vampire. Otherwise, it gets -2/-2." }),
  makeCard({
    name: 'Wolf Lite // Howl Lite',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Wolf Lite', type_line: 'Creature — Human Werewolf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' },
      { object: 'card_face', name: 'Howl Lite', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: '' },
    ],
  } as never),
  makeCard({ name: 'Waxing Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Transform up to one target Werewolf you control. Creatures you control gain trample until end of turn.' }),
  makeCard({ name: 'Roots Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card." }),
  makeCard({ name: 'Journey Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target player shuffles up to three target cards from their graveyard into their library.' }),
  makeCard({ name: 'Quandrix Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose two —\n• Return target creature or planeswalker to its owner's hand.\n• Counter target artifact or enchantment spell.\n• Put two +1/+1 counters on target creature.\n• Target player shuffles up to three target cards from their graveyard into their library." }),
  makeCard({ name: 'Invocation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tap any number of untapped creatures you control. Create a 4/4 white Angel creature token with flying for each creature tapped this way.' }),
  makeCard({ name: 'Skull Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at target player's hand. You may choose a nonland card from it. That player discards that card." }),
  makeCard({ name: 'Skinripper Lite', type_line: 'Creature — Human Assassin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of your end step, if you sacrificed one or more permanents this turn, this creature deals that much damage to any target.' }),
  makeCard({ name: 'Necromancer Lite', type_line: 'Creature — Human Warlock', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, you may exile two cards from your graveyard. When you do, return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Conscript Lite', type_line: 'Creature — Human Mercenary', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, if it was enchanted, create a Junk token.' }),
  makeCard({ name: 'Mantle Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.' }),
  makeCard({ name: 'Wizard Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const drive = (g: GameState, answer: (g: GameState) => GameState | null, limit = 12): GameState => {
  for (let i = 0; i < limit; i++) {
    if (g.pending) {
      const next = answer(g);
      if (!next) break;
      g = next;
    } else if (g.stack.length && g.priority) g = settle(act(g, { type: 'pass', player: g.priority }));
    else break;
  }
  return g;
};
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toAttack(toStep(g, 'beginning_of_combat'));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
/** Through combat damage: no blocks, every priority passed. */
const finishCombat = (g: GameState): GameState => {
  for (let i = 0; i < 60 && g.step !== 'end' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } } as never);
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
};
const clearBattlefield = (g: GameState, who: string) => {
  for (const id of g.zones.battlefield.filter((id) => g.objects[id]!.controller === who)) moveObject(g, id, 'graveyard', []);
};

describe('staples (slice 264)', () => {
  it("Peel from Reality, Reverence, Statecraft, Corrupted Resolve, Rushblade Commander", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [mine, theirs] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Peel Lite', 'hand'), targets: [[{ kind: 'object', object: theirs }], [{ kind: 'object', object: mine }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Peel Lite', 'hand'), targets: [[{ kind: 'object', object: mine }], [{ kind: 'object', object: theirs }]] }));
    expect([g.objects[mine]!.zone, g.objects[theirs]!.zone]).toEqual(['hand', 'hand']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'bob', 'Reverence Lite', 'battlefield');
    const [small, big] = [give(h, 'alice', 'Cub', 'battlefield', { sick: false }), give(h, 'alice', 'Ogre', 'battlefield', { sick: false })];
    const q = toAttack(toStep(h, 'beginning_of_combat'));
    expect(illegal(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: small, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    h = act(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: big, target: { kind: 'player', player: 'bob' } }] } });
    expect(h.combat?.attackers[big]).toBeTruthy();

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(k, 'bob');
    give(k, 'alice', 'Statecraft Lite', 'battlefield');
    const ogre = give(k, 'alice', 'Ogre', 'battlefield', { sick: false });
    const life = k.players.bob!.life;
    k = finishCombat(attackWith(k, [ogre]));
    expect(k.players.bob!.life).toBe(life);
    let k2 = toStep(start({ extra: CARDS }), 'main1', 'bob');
    clearBattlefield(k2, 'alice');
    give(k2, 'alice', 'Statecraft Lite', 'battlefield');
    const raider = give(k2, 'bob', 'Ogre', 'battlefield', { sick: false });
    const wall = give(k2, 'alice', 'Cub', 'battlefield');
    k2 = toAttack(toStep(k2, 'beginning_of_combat'));
    k2 = act(k2, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: raider, target: { kind: 'player', player: 'alice' } }] } });
    k2 = toAttack(k2);
    k2 = act(k2, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: raider }] } } as never);
    k2 = finishCombat(k2);
    expect([k2.objects[wall]!.zone, k2.objects[wall]!.damage]).toEqual(['battlefield', 0]);

    for (const poisoned of [false, true]) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (poisoned) m.players.alice!.poison = 1;
      const salve = give(m, 'alice', 'Salve', 'hand');
      const before = m.players.alice!.life;
      m = act(m, { type: 'cast', player: 'alice', object: salve });
      m = act(m, { type: 'pass', player: 'alice' });
      m = settle(act(m, { type: 'cast', player: 'bob', object: give(m, 'bob', 'Resolve Lite', 'hand'), targets: [[{ kind: 'object', object: salve }]] }));
      expect(m.players.alice!.life - before).toBe(poisoned ? 0 : 3);
    }

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(n, 'alice', 'Rushblade Lite', 'battlefield');
    const [warrior, cub] = [give(n, 'alice', 'Warrior Lite', 'battlefield'), give(n, 'alice', 'Cub', 'battlefield')];
    expect([chars(n, n.objects[warrior]!).keywords.some((x) => x.id === 'haste'), chars(n, n.objects[cub]!).keywords.some((x) => x.id === 'haste')]).toEqual([true, false]);
    n = attackWith(n, [warrior]);
    expect(n.combat?.attackers[warrior]).toBeTruthy();
  });

  it('Golden Ratio, Interpret the Signs, Judge Unworthy, Imagecrafter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(g, 'alice');
    for (const name of ['Cub', 'Cub', 'Ogre', 'Ogre Three']) give(g, 'alice', name, 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Golden Ratio Lite', 'hand') }));
    expect(g.zones.hand.alice!.length - hand).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = give(h, 'alice', 'Ogre Three', 'library');
    h.zones.library.alice!.splice(h.zones.library.alice!.indexOf(top), 1);
    h.zones.library.alice!.unshift(top);
    const h0 = h.zones.hand.alice!.length;
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Interpret Lite', 'hand') });
    h = drive(h, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: (x.pending as { objects: string[] }).objects, bottom: [] } }) : null));
    expect(h.zones.hand.alice!.length - h0).toBe(3);
    expect(h.zones.hand.alice).toContain(top);

    let j = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(j, 'bob');
    const atk = give(j, 'alice', 'Ogre', 'battlefield', { sick: false });
    const card = give(j, 'bob', 'Ogre Three', 'library');
    j.zones.library.bob!.splice(j.zones.library.bob!.indexOf(card), 1);
    j.zones.library.bob!.unshift(card);
    j = attackWith(j, [atk]);
    // Bob responds in the declare attackers step, once Alice passes.
    j = act(j, { type: 'pass', player: 'alice' });
    expect([j.step, j.priority]).toEqual(['declare_attackers', 'bob']);
    j = act(j, { type: 'cast', player: 'bob', object: give(j, 'bob', 'Judge Lite', 'hand'), targets: [[{ kind: 'object', object: atk }]] });
    j = drive(j, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'scry', top: (x.pending as { objects: string[] }).objects, bottom: [] } }) : null));
    expect(j.objects[atk]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const crafter = give(k, 'alice', 'Imagecrafter Lite', 'battlefield', { sick: false });
    const bear = give(k, 'bob', 'Cub', 'battlefield');
    k = act(k, { type: 'activate', player: 'alice', object: crafter, ability: 0, targets: [[{ kind: 'object', object: bear }]] });
    k = settle(k);
    expect(k.pending?.kind).toBe('choose_option');
    expect((k.pending as { options: string[] }).options).not.toContain('Wall');
    k = settle(act(k, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Elf' } }));
    expect(chars(k, k.objects[bear]!).subtypes).toEqual(['Elf']);
  });

  it('Nantuko Cultivator, Kingpin, Long Feng, Arachnus Web', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...g.zones.hand.alice!]) moveObject(g, id, 'graveyard', []);
    const lands = [give(g, 'alice', 'Forest', 'hand'), give(g, 'alice', 'Forest', 'hand'), give(g, 'alice', 'Forest', 'hand')];
    give(g, 'alice', 'Salve', 'hand');
    const cultivator = give(g, 'alice', 'Cultivator Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cultivator });
    g = drive(g, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: lands.slice(0, 2) } }) : x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([g.objects[cultivator]!.counters['+1/+1'], g.zones.hand.alice!.length, g.objects[lands[2]!]!.zone]).toEqual([2, 4, 'hand']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kingpin = give(h, 'alice', 'Kingpin Lite', 'battlefield');
    const altar = give(h, 'alice', 'Altar Lite', 'battlefield');
    const treasures = () => h.zones.battlefield.filter((id) => h.objects[id]!.token && h.objects[id]!.controller === 'alice').length;
    for (const victim of [give(h, 'alice', 'Cub', 'battlefield'), give(h, 'alice', 'Cub', 'battlefield')]) {
      h = settle(act(h, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [victim] } }));
    }
    expect(treasures()).toBe(2);
    h = drive(toStep(h, 'main1', 'bob'), () => null);
    h = drive(toStep(h, 'main1', 'alice'), () => null);
    h = settle(act(h, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [kingpin] } }));
    expect(treasures()).toBe(4);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const feng = give(k, 'alice', 'Long Feng Lite', 'battlefield');
    const landAltar = give(k, 'alice', 'Land Altar Lite', 'battlefield');
    const forest = give(k, 'alice', 'Forest', 'battlefield');
    k = act(k, { type: 'activate', player: 'alice', object: landAltar, ability: 0, costs: { sacrifice: [forest] } });
    k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: feng }]] } }) : null));
    expect(k.objects[feng]!.counters['+1/+1']).toBe(1);

    for (const [name, gone] of [['Ogre', true], ['Cub', false]] as const) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const host = give(m, 'bob', name, 'battlefield');
      const web = give(m, 'alice', 'Web Lite', 'hand');
      m = settle(act(m, { type: 'cast', player: 'alice', object: web, targets: [[{ kind: 'object', object: host }]] }));
      expect(m.objects[web]!.zone).toBe('battlefield');
      m = drive(settle(toStep(m, 'end', 'alice')), () => null);
      expect(m.objects[web]!.zone).toBe(gone ? 'graveyard' : 'battlefield');
    }
  });

  it('Energy Field, Guardian Naga, Obstinate Gargoyle, Tectonic Instability, Fanatic of the Harrowing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Energy Field Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(life);
    g = drive(toStep(g, 'main1', 'alice'), () => null);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(life - g.players.alice!.life).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const naga = give(h, 'alice', 'Naga Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: naga }]] }));
    expect([h.objects[naga]!.zone, h.objects[naga]!.damage]).toEqual(['battlefield', 0]);
    h = drive(toStep(h, 'main1', 'bob'), () => null);
    h = settle(act(h, { type: 'cast', player: 'bob', object: give(h, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: naga }]] }));
    expect(h.objects[naga]!.zone).toBe('graveyard');

    const k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gargoyle = give(k, 'alice', 'Gargoyle Lite', 'battlefield');
    expect(chars(k, k.objects[gargoyle]!).keywords.some((x) => x.id === 'flying')).toBe(false);
    k.objects[gargoyle]!.counters['+1/+1'] = 1;
    expect(chars(k, k.objects[gargoyle]!).keywords.some((x) => x.id === 'flying')).toBe(true);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(m, 'bob', 'Instability Lite', 'battlefield');
    for (const who of ['alice', 'alice', 'bob', 'bob']) give(m, who, 'Forest', 'battlefield');
    const mine = m.zones.battlefield.filter((id) => m.objects[id]!.controller === 'alice' && chars(m, m.objects[id]!).types.includes('Land'));
    const theirs = m.zones.battlefield.filter((id) => m.objects[id]!.controller === 'bob' && chars(m, m.objects[id]!).types.includes('Land'));
    m = settle(act(m, { type: 'play_land', player: 'alice', object: give(m, 'alice', 'Forest', 'hand') }));
    expect(mine.length).toBeGreaterThan(0);
    expect([mine.every((id) => m.objects[id]!.tapped), theirs.some((id) => m.objects[id]!.tapped)]).toEqual([true, false]);

    for (const holding of [false, true]) {
      let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const id of [...n.zones.hand.alice!]) moveObject(n, id, 'graveyard', []);
      if (holding) give(n, 'alice', 'Salve', 'hand');
      n = act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Fanatic Lite', 'hand') });
      n = drive(n, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: x.pending.player, answer: { kind: 'discard', objects: x.zones.hand[x.pending.player]!.slice(0, 1) } }) : null));
      expect(n.zones.hand.alice!.length).toBe(holding ? 1 : 0);
    }
  });

  it('Sonar Strike, Gift of Fangs, Waxing Moon, Roots of Wisdom', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [tapped, untapped] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    g.objects[tapped]!.tapped = true;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sonar Lite', 'hand'), targets: [[{ kind: 'object', object: untapped }]] })).toBeTruthy();
    const g2 = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sonar Lite', 'hand'), targets: [[{ kind: 'object', object: tapped }]] }));
    expect(g2.objects[tapped]!.zone).toBe('graveyard');

    for (const name of ['Vampire Lite', 'Ogre']) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const host = give(h, 'alice', name, 'battlefield');
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Fangs Lite', 'hand'), targets: [[{ kind: 'object', object: host }]] }));
      const c = chars(h, h.objects[host]!);
      expect([c.power, c.toughness]).toEqual(name === 'Ogre' ? [3, 1] : [4, 4]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wolf = give(k, 'alice', 'Wolf Lite // Howl Lite', 'battlefield');
    const cub = give(k, 'alice', 'Cub', 'battlefield');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Waxing Lite', 'hand'), targets: [[{ kind: 'object', object: wolf }]] }));
    expect([chars(k, k.objects[wolf]!).power, chars(k, k.objects[cub]!).keywords.some((x) => x.id === 'trample')]).toEqual([4, true]);
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Waxing Lite', 'hand'), targets: [[]] }));
    expect(chars(k, k.objects[wolf]!).power).toBe(4);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h0 = m.zones.hand.alice!.length;
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Roots Lite', 'hand') });
    m = drive(m, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: (x.pending as { candidates: string[] }).candidates.slice(0, 1) } }) : null));
    expect(m.zones.hand.alice!.length - h0).toBe(1);
    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...n.zones.library.alice!, ...n.zones.graveyard.alice!]) moveObject(n, id, 'exile', []);
    for (let i = 0; i < 5; i++) give(n, 'alice', 'Salve', 'library');
    const n0 = n.zones.hand.alice!.length;
    n = drive(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Roots Lite', 'hand') }), () => null);
    n = settle(n);
    expect([n.zones.hand.alice!.length - n0, n.zones.library.alice!.length]).toEqual([1, 1]);
  });

  it("Memory's Journey, Quandrix Command, Devout Invocation, Cracked Skull", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = [give(g, 'bob', 'Cub', 'graveyard'), give(g, 'bob', 'Ogre', 'graveyard')];
    const mine = give(g, 'alice', 'Cub', 'graveyard');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Journey Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: mine }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Journey Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }], theirs.map((object) => ({ kind: 'object' as const, object }))] }));
    expect([...theirs.map((id) => g.objects[id]!.zone), g.objects[mine]!.zone]).toEqual(['library', 'library', 'graveyard']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(h, 'alice', 'Cub', 'battlefield');
    const dead = give(h, 'bob', 'Ogre', 'graveyard');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Quandrix Lite', 'hand'), modes: [2, 3], targets: [[{ kind: 'object', object: bear }], [{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: dead }]] }));
    expect([h.objects[bear]!.counters['+1/+1'], h.objects[dead]!.zone]).toEqual([2, 'library']);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(k, 'alice');
    const crew = [give(k, 'alice', 'Cub', 'battlefield'), give(k, 'alice', 'Cub', 'battlefield'), give(k, 'alice', 'Cub', 'battlefield')];
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Invocation Lite', 'hand') });
    k = drive(k, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: crew.slice(0, 2) } }) : null));
    const angels = k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Angel'));
    expect([angels.length, crew.map((id) => k.objects[id]!.tapped)]).toEqual([2, [true, true, false]]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...m.zones.hand.bob!]) moveObject(m, id, 'graveyard', []);
    const [land, salve] = [give(m, 'bob', 'Forest', 'hand'), give(m, 'bob', 'Salve', 'hand')];
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Skull Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    m = settle(m);
    expect(m.pending?.kind).toBe('choose_objects');
    expect([(m.pending as { candidates: string[] }).candidates, [...((m.pending as { seen?: string[] }).seen ?? [])].sort()]).toEqual([[salve], [land, salve].sort()]);
    m = settle(act(m, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [salve] } }));
    expect([m.objects[salve]!.zone, m.objects[land]!.zone]).toEqual(['graveyard', 'hand']);
  });

  it('Sawblade Skinripper, Young Necromancer, Gunner Conscript', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Skinripper Lite', 'battlefield');
    const altar = give(g, 'alice', 'Altar Lite', 'battlefield');
    for (const victim of [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')]) {
      g = settle(act(g, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [victim] } }));
    }
    const life = g.players.bob!.life;
    g = drive(toStep(g, 'end', 'alice'), (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : null));
    g = settle(g);
    expect(life - g.players.bob!.life).toBe(2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...h.zones.graveyard.alice!]) moveObject(h, id, 'exile', []);
    const fuel = [give(h, 'alice', 'Salve', 'graveyard'), give(h, 'alice', 'Bolt', 'graveyard')];
    const ogre = give(h, 'alice', 'Ogre', 'graveyard');
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Necromancer Lite', 'hand') });
    h = drive(h, (x) =>
      x.pending?.kind === 'may'
        ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } })
        : x.pending?.kind === 'choose_objects'
          ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: fuel } })
          : x.pending?.kind === 'trigger_targets'
            ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] } })
            : null,
    );
    expect([...fuel.map((id) => h.objects[id]!.zone), h.objects[ogre]!.zone]).toEqual(['exile', 'exile', 'battlefield']);
    let h2 = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...h2.zones.graveyard.alice!]) moveObject(h2, id, 'exile', []);
    const lone = give(h2, 'alice', 'Ogre', 'graveyard');
    h2 = act(h2, { type: 'cast', player: 'alice', object: give(h2, 'alice', 'Necromancer Lite', 'hand') });
    h2 = drive(h2, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([h2.pending?.kind, h2.objects[lone]!.zone]).toEqual([undefined, 'graveyard']);

    for (const enchanted of [false, true]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const conscript = give(k, 'alice', 'Conscript Lite', 'battlefield');
      if (enchanted) k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Mantle Lite', 'hand'), targets: [[{ kind: 'object', object: conscript }]] }));
      k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: conscript }]] }));
      k = settle(k);
      const junk = k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Junk'));
      expect(junk.length).toBe(enchanted ? 1 : 0);
    }
    expect(legalActions).toBeTruthy();
  });
});

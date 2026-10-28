import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Pollywog Prodigy', type_line: 'Creature — Frog Wizard', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Whenever an opponent casts a noncreature spell with mana value less than this creature's power, draw a card." }),
  makeCard({ name: 'Baral, Chief of Compliance', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.' }),
  makeCard({ name: 'Dour Port-Mage', type_line: 'Creature — Frog Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever one or more other creatures you control leave the battlefield without dying, draw a card.\n{1}{U}, {T}: Return another target creature you control to its owner\'s hand.' }),
  makeCard({ name: 'Terastodon', type_line: 'Creature — Elephant', mana_cost: '{0}', power: '9', toughness: '9', oracle_text: 'When this creature enters, you may destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.' }),
  makeCard({ name: 'Priest of Forgotten Gods', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: '{T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.' }),
  makeCard({ name: 'Genesis Wave', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: "Reveal the top X cards of your library. You may put any number of permanent cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard." }),
  makeCard({ name: 'Grab the Prize', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, discard a card.\nDraw two cards. If the discarded card wasn't a land card, Grab the Prize deals 2 damage to each opponent." }),
  makeCard({ name: 'Twitching Doll', type_line: 'Artifact Creature — Spider Toy', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{T}, Sacrifice this creature: Create a 2/2 green Spider creature token with reach for each counter on this creature. Activate only as a sorcery.' }),
  makeCard({ name: 'Meren of Clan Nel Toth', type_line: 'Legendary Creature — Human Shaman', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: "At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand." }),
  makeCard({ name: 'Falkenrath Aristocrat', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '4', toughness: '1', oracle_text: 'Sacrifice a creature: This creature gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Counterspell', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{1}', cmc: 1, oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Big Spell', type_line: 'Sorcery', mana_cost: '{3}', cmc: 3, oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Peasant', type_line: 'Creature — Human Peasant', mana_cost: '{W}', cmc: 1, colors: ['W'], power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Charm', type_line: 'Enchantment', mana_cost: '{W}', cmc: 1, colors: ['W'], oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });

describe('staples (slice 175)', () => {
  it("Pollywog Prodigy: an opponent's noncreature spell with mana value less than its power draws a card", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Pollywog Prodigy', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g.players.bob!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Big Spell', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Baral: countering a spell lets you loot', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Baral, Chief of Compliance', 'battlefield');
    g.players.bob!.pool.C = 3;
    const spell = give(g, 'bob', 'Big Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: spell });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Counterspell', 'hand'), targets: [[obj(spell)]] });
    g = settle(g);
    expect(g.objects[spell]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'may' });
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [g.zones.hand.alice![0]!] } } as never);
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand);
  });

  it('Dour Port-Mage: creatures leaving without dying draw once per batch; dying does not', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mage = give(g, 'alice', 'Dour Port-Mage', 'battlefield');
    g.objects[mage]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: mage, ability: 0, targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('hand');
    // The Bear went to the hand (+1), and the trigger drew a card (+1).
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.players.bob!.pool.C = 1;
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Shock', 'hand'), targets: [[obj(ogre)]] }));
    const before = g.zones.hand.alice!.length;
    g.objects[ogre]!.damage = 5;
    g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(before);
  });

  it("Terastodon: each permanent put into a graveyard gives its controller an Elephant", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const charm = give(g, 'bob', 'Charm', 'battlefield');
    const mine = give(g, 'alice', 'Relic', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Terastodon', 'hand') }));
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(relic), obj(charm), obj(mine)]] } });
    g = settle(g);
    if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    const elephants = (p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && g.cards[g.objects[id]!.card]?.name === 'Elephant Token').length;
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(elephants('bob')).toBe(2);
    expect(elephants('alice')).toBe(1);
  });

  it('Priest of Forgotten Gods: any number of target players each lose 2 life and sacrifice a creature; {B}{B} and a card', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const priest = give(g, 'alice', 'Priest of Forgotten Gods', 'battlefield');
    g.objects[priest]!.sick = false;
    const fodder = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    const bobs = give(g, 'bob', 'Ogre', 'battlefield');
    const carols = give(g, 'carol', 'Ogre', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'activate', player: 'alice', object: priest, ability: 0, costs: { sacrifice: fodder }, targets: [[{ kind: 'player', player: 'bob' }, { kind: 'player', player: 'carol' }]] });
    g = settle(g);
    expect(g.players.bob!.life).toBe(18);
    expect(g.players.carol!.life).toBe(18);
    expect(g.objects[bobs]!.zone).toBe('graveyard');
    expect(g.objects[carols]!.zone).toBe('graveyard');
    expect(g.players.alice!.pool.B).toBe(2);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Genesis Wave: permanent cards with mana value X or less onto the battlefield, the rest to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const cards = ['Bear', 'Ogre', 'Big Spell'].map((n) => give(g, 'alice', n, 'library'));
    for (const id of cards) lib.splice(lib.indexOf(id), 1);
    lib.unshift(...cards);
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Genesis Wave', 'hand'), x: 3 }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects' });
    expect((g.pending as { candidates: string[] }).candidates).toEqual([cards[0]]);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cards[0]!] } }));
    expect(g.objects[cards[0]!]!.zone).toBe('battlefield');
    expect(g.objects[cards[1]!]!.zone).toBe('graveyard');
    expect(g.objects[cards[2]!]!.zone).toBe('graveyard');
  });

  it("Grab the Prize: 2 damage to each opponent only if the discarded card wasn't a land card", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Forest', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grab the Prize', 'hand'), costs: { discard: [land] } }));
    expect(g.players.bob!.life).toBe(20);
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grab the Prize', 'hand'), costs: { discard: [bear] } }));
    expect(g.players.bob!.life).toBe(18);
  });

  it('Twitching Doll: a Spider for each counter it had as it was sacrificed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const doll = give(g, 'alice', 'Twitching Doll', 'battlefield');
    g.objects[doll]!.sick = false;
    g.objects[doll]!.counters.nest = 3;
    const offer = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === doll && (a as { ability: number }).ability === 0);
    expect(offer).toBeTruthy();
    g = settle(act(g, offer!));
    const spiders = g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === 'Spider Token').length;
    expect(spiders).toBe(3);
  });

  it('Meren: back to the battlefield if its mana value is at most your experience counters; otherwise to your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Meren of Clan Nel Toth', 'battlefield');
    (g.players.alice!.counters ??= {}).experience = 2;
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const ogre = give(g, 'alice', 'Ogre', 'graveyard');
    g = toStep(g, 'end', 'alice');
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(ogre)]] } });
    g = settle(g);
    expect(g.objects[ogre]!.zone).toBe('hand');
    g = toStep(toStep(g, 'main1', 'bob'), 'end', 'alice');
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(bear)]] } });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Falkenrath Aristocrat: a +1/+1 counter only if the sacrificed creature was a Human', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vamp = give(g, 'alice', 'Falkenrath Aristocrat', 'battlefield');
    const peasant = give(g, 'alice', 'Peasant', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: vamp, ability: 0, costs: { sacrifice: [bear] } }));
    expect(g.objects[vamp]!.counters['+1/+1'] ?? 0).toBe(0);
    g = settle(act(g, { type: 'activate', player: 'alice', object: vamp, ability: 0, costs: { sacrifice: [peasant] } }));
    expect(g.objects[vamp]!.counters['+1/+1']).toBe(1);
  });
});

describe('staples (slice 175): counters as they last existed', () => {
  const MORE = [
    makeCard({ name: 'Unwilling Vessel', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'When this creature dies, create an X/X blue Spirit creature token with flying, where X is the number of counters on this creature.' }),
    makeCard({ name: 'Parting Thoughts', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target creature. You draw X cards and you lose X life, where X is the number of counters on that creature.' }),
    makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
    makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
  ];
  it('Unwilling Vessel: an X/X Spirit, X its counters as it died', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const vessel = give(g, 'alice', 'Unwilling Vessel', 'battlefield');
    g.objects[vessel]!.counters.possession = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(vessel)]] }));
    const spirit = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => g.cards[o.card]?.name === 'Spirit Token');
    expect(spirit).toBeTruthy();
    expect(chars(g, spirit!).power).toBe(3);
  });
  it('Parting Thoughts: counts the counters the creature had', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 2;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Parting Thoughts', 'hand'), targets: [[obj(bear)]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.players.alice!.life).toBe(18);
  });
});

describe('staples (slice 175): more', () => {
  const MORE = [
    makeCard({ name: 'Codsworth, Handy Helper', type_line: 'Legendary Artifact Creature — Robot', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{T}: Attach target Aura or Equipment you control to target creature you control. Activate only as a sorcery.' }),
    makeCard({ name: 'Blade', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+0.\nEquip {3}' }),
    makeCard({ name: 'Arachnogenesis', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures.' }),
    makeCard({ name: 'Kediss, Emberclaw Familiar', type_line: 'Legendary Creature — Elemental Lizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever a commander you control deals combat damage to an opponent, it deals that much damage to each other opponent.' }),
    makeCard({ name: 'Liberator, Urza\'s Battlethopter', type_line: 'Legendary Artifact Creature — Thopter', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever you cast a spell, if the amount of mana spent to cast that spell is greater than Liberator's power, put a +1/+1 counter on Liberator." }),
    makeCard({ name: 'It That Betrays', type_line: 'Creature — Eldrazi', mana_cost: '{0}', power: '11', toughness: '11', oracle_text: 'Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control.' }),
    makeCard({ name: 'Twinflame', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Choose any number of target creatures you control. For each of them, create a token that's a copy of that creature, except it has haste. Exile those tokens at the beginning of the next end step." }),
    makeCard({ name: 'Astral Cornucopia', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Choose a color. Add one mana of that color for each charge counter on this artifact.' }),
    makeCard({ name: 'Fling Fodder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice a permanent.\nYou gain 1 life.' }),
    makeCard({ name: 'Two Drop', type_line: 'Sorcery', mana_cost: '{2}', cmc: 2, oracle_text: 'You gain 1 life.' }),
    makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
    makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  ];
  const toAttack = (g: GameState) => {
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    return g;
  };

  it('Codsworth: attaches an Equipment you control to a creature you control', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const cods = give(g, 'alice', 'Codsworth, Handy Helper', 'battlefield');
    g.objects[cods]!.sick = false;
    const blade = give(g, 'alice', 'Blade', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cods, ability: 0, targets: [[obj(blade)], [obj(bear)]] }));
    expect(g.objects[blade]!.attachedTo?.id).toBe(bear);
  });

  it('Arachnogenesis: a Spider for each creature attacking you', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'bob');
    const bears = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    for (const b of bears) g.objects[b]!.sick = false;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: bears.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Arachnogenesis', 'hand') }));
    const spiders = g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === 'Spider Token' && g.objects[id]!.controller === 'alice').length;
    expect(spiders).toBe(2);
  });

  it('Liberator: a +1/+1 counter when more mana than its power was spent', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const lib = give(g, 'alice', "Liberator, Urza's Battlethopter", 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') }));
    expect(g.objects[lib]!.counters['+1/+1']).toBe(1);
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') }));
    expect(g.objects[lib]!.counters['+1/+1']).toBe(1);
  });

  it('It That Betrays: a nontoken permanent an opponent sacrifices comes to you', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'bob');
    give(g, 'alice', 'It That Betrays', 'battlefield');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Fling Fodder', 'hand'), costs: { sacrifice: [relic] } }));
    expect(g.objects[relic]!.zone).toBe('battlefield');
    expect(g.objects[relic]!.controller).toBe('alice');
  });

  it('Twinflame: a hasty copy of each target, exiled at the next end step', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const bears = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinflame', 'hand'), targets: [bears.map(obj)] }));
    const copies = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.cards[g.objects[id]!.card]?.name === 'Bear');
    expect(copies().length).toBe(2);
    g = toStep(g, 'main1', 'bob');
    expect(copies().length).toBe(0);
  });

  it('Astral Cornucopia: one mana of the chosen color for each charge counter', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const corn = give(g, 'alice', 'Astral Cornucopia', 'battlefield');
    g.objects[corn]!.counters.charge = 3;
    const offer = legalActions(g, 'alice').find((a) => a.type === 'activate_mana' && a.object === corn && (a as { choice?: string }).choice === 'G');
    expect(offer).toBeTruthy();
    g = act(g, offer!);
    expect(g.players.alice!.pool.G).toBe(3);
  });
});

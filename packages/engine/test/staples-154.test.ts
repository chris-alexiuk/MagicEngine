import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Panharmonicon', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
  makeCard({ name: 'Greenwarden', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '5', toughness: '7', oracle_text: 'If a land entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
  makeCard({ name: 'Warden', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever another creature enters, you gain 1 life.' }),
  makeCard({ name: 'Landfaller', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Landfall — Whenever a land you control enters, you gain 1 life.' }),
  makeCard({ name: 'Teysa', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
  makeCard({ name: 'Artist', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: 'Whenever another creature you control dies, each opponent loses 1 life.' }),
  makeCard({ name: 'Torpor', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures entering don't cause abilities to trigger." }),
  makeCard({ name: 'Norn', type_line: 'Legendary Creature — Phyrexian Praetor', mana_cost: '{0}', power: '4', toughness: '7', oracle_text: "If a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nPermanents entering don't cause abilities of permanents your opponents control to trigger." }),
  makeCard({ name: 'Delney', type_line: 'Legendary Creature — Human Scout', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'If a triggered ability of a creature you control with power 2 or less triggers, that ability triggers an additional time.' }),
  makeCard({ name: 'Healer', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, you gain 2 life.' }),
  makeCard({ name: 'Brute', type_line: 'Creature — Giant', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, you gain 2 life.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Plains Card', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {W}.' }),
  makeCard({ name: 'Fiction', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.' }),
  makeCard({ name: 'Augury', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.' }),
  makeCard({ name: 'Selvala', type_line: 'Legendary Creature — Elf Scout', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "Whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power.\n{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control." }),
  makeCard({ name: 'Cataracts', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{5}, {T}: Add five mana in any combination of colors.' }),
  makeCard({ name: 'Harvest', type_line: 'Instant', mana_cost: '{0}', oracle_text: "For each token you control, create a token that's a copy of that permanent." }),
  makeCard({ name: 'Soldiers', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two 1/1 white Soldier creature tokens.' }),
  makeCard({ name: 'Astor', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Equipment you control have equip {1}.' }),
  makeCard({ name: 'Hammer', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+0.\nEquip {4}' }),
  makeCard({ name: 'Champion', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Creatures with power less than this creature's power can't block creatures you control." }),
  makeCard({ name: 'Throne', type_line: 'Artifact Creature — Golem', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nIf a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const tokens = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);

describe('staples (slice 154)', () => {
  it('Panharmonicon doubles triggers from an artifact or creature entering, not from a land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Panharmonicon', 'battlefield');
    give(g, 'alice', 'Warden', 'battlefield');
    give(g, 'alice', 'Landfaller', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 2);
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains Card', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 3);
  });

  it('Ancient Greenwarden doubles landfall', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Greenwarden', 'battlefield');
    give(g, 'alice', 'Landfaller', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains Card', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 2);
  });

  it('Teysa Karlov doubles death triggers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Teysa', 'battlefield');
    give(g, 'alice', 'Artist', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it("Torpor Orb: creatures entering don't trigger anything; Elesh Norn stops only opponents'", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const torpor = give(g, 'bob', 'Torpor', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Healer', 'hand') }));
    expect(g.players.alice!.life).toBe(life);
    g.objects[torpor]!.zone = 'exile';
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== torpor);
    give(g, 'bob', 'Norn', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Healer', 'hand') }));
    expect(g.players.alice!.life).toBe(life);
    const bobLife = g.players.bob!.life;
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Healer', 'hand') }));
    expect(g.players.bob!.life).toBe(bobLife + 4);
  });

  it('Delney: triggers of small creatures happen twice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Delney', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Healer', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 4);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Brute', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 6);
  });

  it('Roaming Throne: is the chosen type, and doubles that type', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const throne = give(g, 'alice', 'Throne', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: throne });
    g = settle(g);
    if (g.pending?.kind === 'as_enters') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Cleric' } }));
    expect(g.objects[throne]!.chosen?.creatureType).toBe('Cleric');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Healer', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 4);
  });

  it('Fact or Fiction: an opponent separates, you choose', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.alice!.slice(0, 5);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fiction', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    expect(g.pending?.player).toBe('bob');
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: top.slice(0, 1) } });
    expect(g.pending?.kind).toBe('choose_option');
    expect(g.pending?.player).toBe('alice');
    const options = (g.pending as { options: string[] }).options;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: options[1]! } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 4);
    expect(g.objects[top[0]!]!.zone).toBe('graveyard');
  });

  it('Steam Augury: you separate, an opponent chooses', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.alice!.slice(0, 5);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Augury', 'hand') }));
    expect(g.pending?.player).toBe('alice');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: top.slice(0, 2) } });
    expect(g.pending?.player).toBe('bob');
    const options = (g.pending as { options: string[] }).options;
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: options[0]! } }));
    expect(top.slice(0, 2).every((id) => g.objects[id]!.zone === 'hand')).toBe(true);
    expect(top.slice(2).every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
  });

  it('Selvala: X mana in any combination; a draw for the biggest creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const selvala = give(g, 'alice', 'Selvala', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    const bobHand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Brute', 'hand') }));
    if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.zones.hand.bob!.length).toBe(bobHand);
    g.players.alice!.pool.G = 1;
    const options = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === selvala);
    expect(options.length).toBeGreaterThan(0);
    g = act(g, { type: 'activate_mana', player: 'alice', object: selvala, ability: 0, choice: 'GGUUR' });
    expect(g.players.alice!.pool).toMatchObject({ G: 2, U: 2, R: 1 });
  });

  it('Cascading Cataracts: five mana of any colors', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Cataracts', 'battlefield');
    g.players.alice!.pool.C = 5;
    g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 1, choice: 'WUBRG' });
    expect(g.players.alice!.pool).toMatchObject({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 });
  });

  it('Second Harvest copies each token', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldiers', 'hand') }));
    expect(tokens(g, 'alice')).toHaveLength(2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Harvest', 'hand') }));
    expect(tokens(g, 'alice')).toHaveLength(4);
  });

  it('Astor: Equipment you control have equip {1}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Astor', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const hammer = give(g, 'alice', 'Hammer', 'battlefield');
    g.players.alice!.pool.C = 1;
    const equips = legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === hammer);
    expect(equips.length).toBeGreaterThan(0);
    const ability = (equips.at(-1) as { ability: number }).ability;
    g = settle(act(g, { type: 'activate', player: 'alice', object: hammer, ability, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[hammer]!.attachedTo?.id).toBe(bear);
  });

  it("Champion of Lambholt: smaller creatures can't block your creatures", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Champion', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Bear', 'battlefield');
    const big = give(g, 'bob', 'Brute', 'battlefield');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: bear }] } } as never)).toThrow();
    act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: big, attacker: bear }] } } as never);
  });
});

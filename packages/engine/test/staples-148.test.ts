import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Bog', type_line: 'Land', mana_cost: '', oracle_text: 'When this land enters, exile target player\'s graveyard.' }),
  makeCard({ name: 'Will', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Add {R} for each card in target opponent's hand." }),
  makeCard({ name: 'Dominance', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Choose a creature type. Destroy all creatures that aren't of the chosen type." }),
  makeCard({ name: 'Melody', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a creature type. Draw a card for each permanent you control of that type.' }),
  makeCard({ name: 'Fumigate', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures. You gain 1 life for each creature destroyed this way.' }),
  makeCard({ name: 'Culling', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy each nonland permanent with mana value 2 or less. Add {B} or {G} for each permanent destroyed this way.' }),
  makeCard({ name: 'Nykthos', type_line: 'Legendary Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.' }),
  makeCard({ name: 'Acolyte', type_line: 'Creature — Human', mana_cost: '{G}{G}', cmc: 2, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{G}', cmc: 1, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Plaguecrafter', type_line: 'Creature — Human Shaman', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "When this creature enters, each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card." }),
  makeCard({ name: 'Diamond', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant." }),
  makeCard({ name: 'Wonder', type_line: 'Creature — Incarnation', mana_cost: '{3}{U}', power: '2', toughness: '2', oracle_text: 'Flying\nAs long as this card is in your graveyard and you control an Island, creatures you control have flying.' }),
  makeCard({ name: 'Gravecrawler', type_line: 'Creature — Zombie', mana_cost: '{B}', cmc: 1, power: '2', toughness: '1', oracle_text: "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie." }),
  makeCard({ name: 'Zombie', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Expertise', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You may cast a spell with mana value 2 or less from your hand without paying its mana cost.' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Reversal', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy." }),
  makeCard({ name: 'Inspire', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Evolution', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile Evolution." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const choose = (g: GameState, choice: string) => act(g, { type: 'choose', player: g.pending!.player, answer: { kind: 'choose_option', choice } });

describe('staples (slice 148)', () => {
  it("Bojuka Bog exiles only the target player's graveyard", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Inspire', 'graveyard');
    const theirs = give(g, 'bob', 'Inspire', 'graveyard');
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Bog', 'hand') });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
    g = settle(g);
    expect(g.objects[theirs]!.zone).toBe('exile');
    expect(g.objects[mine]!.zone).toBe('graveyard');
  });

  it("Jeska's Will: {R} for each card in target opponent's hand", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const n = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Will', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.alice!.pool.R).toBe(n);
  });

  it('Kindred Dominance and Distant Melody: the type chosen as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Elf', 'battlefield');
    give(g, 'alice', 'Elf', 'battlefield');
    const human = give(g, 'bob', 'Acolyte', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Melody', 'hand') });
    g = settle(g);
    expect(g.pending?.kind).toBe('choose_option');
    g = settle(choose(g, 'Elf'));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dominance', 'hand') }));
    g = settle(choose(g, 'Elf'));
    expect(g.objects[elf]!.zone).toBe('battlefield');
    expect(g.objects[human]!.zone).toBe('graveyard');
  });

  it('Fumigate and Culling Ritual count what was destroyed this way', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Elf', 'battlefield');
    give(g, 'bob', 'Acolyte', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fumigate', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 3);
    give(g, 'alice', 'Elf', 'battlefield');
    give(g, 'bob', 'Acolyte', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Culling', 'hand') }));
    expect(g.pending?.kind).toBe('choose_option');
    expect((g.pending as { options: string[] }).options).toEqual(['{B}{B}', '{B}{G}', '{G}{G}']);
    g = choose(g, '{B}{G}');
    expect(g.players.alice!.pool.B).toBe(1);
    expect(g.players.alice!.pool.G).toBe(1);
  });

  it('Nykthos: mana equal to devotion to the chosen color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const nykthos = give(g, 'alice', 'Nykthos', 'battlefield');
    give(g, 'alice', 'Acolyte', 'battlefield');
    give(g, 'alice', 'Elf', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'activate_mana', player: 'alice', object: nykthos, ability: 1, choice: 'G' });
    expect(g.players.alice!.pool.G).toBe(3);
  });

  it("Plaguecrafter: a player who can't sacrifice discards", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bobHand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Plaguecrafter', 'hand') }));
    g = settle(g);
    // Alice sacrifices Plaguecrafter itself; Bob has no creature, so he discards.
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'bob', count: 1 });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: [g.zones.hand.bob![0]!] } });
    g = settle(g);
    expect(g.zones.hand.bob!.length).toBe(bobHand - 1);
    expect(g.zones.graveyard.alice!.some((id) => g.objects[id]!.card === 'Plaguecrafter')).toBe(true);
  });

  it("Lion's Eye Diamond: discard your hand as a cost; only with priority", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const led = give(g, 'alice', 'Diamond', 'battlefield');
    expect(g.zones.hand.alice!.length).toBeGreaterThan(0);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === led)).toBe(true);
    g = act(g, { type: 'activate_mana', player: 'alice', object: led, ability: 0, choice: 'R' });
    expect(g.players.alice!.pool.R).toBe(3);
    expect(g.zones.hand.alice!.length).toBe(0);
    expect(g.objects[led]!.zone).toBe('graveyard');
  });

  it('Wonder works from the graveyard with an Island', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Elf', 'battlefield');
    const wonder = give(g, 'alice', 'Wonder', 'graveyard');
    expect(hasKeyword(g, g.objects[elf]!, 'flying')).toBe(false);
    give(g, 'alice', 'Island', 'battlefield');
    expect(hasKeyword(g, g.objects[elf]!, 'flying')).toBe(true);
    // Not for the opponent's creatures, and not from the battlefield.
    const theirs = give(g, 'bob', 'Elf', 'battlefield');
    expect(hasKeyword(g, g.objects[theirs]!, 'flying')).toBe(false);
    g.zones.graveyard.alice = g.zones.graveyard.alice!.filter((id) => id !== wonder);
    expect(hasKeyword(g, g.objects[elf]!, 'flying')).toBe(false);
  });

  it('Gravecrawler: cast from the graveyard while you control a Zombie', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const crawler = give(g, 'alice', 'Gravecrawler', 'graveyard');
    g.players.alice!.pool.B = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: crawler, alt: 'alt' })).toBeTruthy();
    give(g, 'alice', 'Zombie', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: crawler, alt: 'alt' }));
    expect(g.objects[crawler]!.zone).toBe('battlefield');
    expect(g.players.alice!.pool.B).toBe(0);
  });

  it("Rishkar's Expertise: a spell with mana value 2 or less from the hand, free", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const acolyte = give(g, 'alice', 'Acolyte', 'hand');
    const ogre = give(g, 'alice', 'Ogre', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Expertise', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    const cands = (g.pending as { candidates: string[] }).candidates;
    expect(cands).toContain(acolyte);
    expect(cands).not.toContain(ogre);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [acolyte] } });
    expect(g.pending?.kind).toBe('cast_free');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.objects[acolyte]!.zone).toBe('battlefield');
  });

  it("Narset's Reversal copies the spell and returns it to its owner's hand", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const inspire = give(g, 'bob', 'Inspire', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: inspire });
    g = act(g, { type: 'pass', player: 'bob' });
    const aliceHand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Reversal', 'hand'), targets: [[{ kind: 'object', object: inspire }]] });
    g = settle(g);
    if (g.pending?.kind === 'copy_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } }));
    expect(g.objects[inspire]!.zone).toBe('hand');
    expect(g.zones.hand.alice!.length).toBe(aliceHand + 2);
  });

  it("Eldritch Evolution: mana value up to 2 plus the sacrificed creature's", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Elf', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'library');
    give(g, 'alice', 'Acolyte', 'library');
    const evo = give(g, 'alice', 'Evolution', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: evo, costs: { sacrifice: [elf] } }));
    expect(g.pending?.kind).toBe('search');
    expect((g.pending as { candidates: string[] }).candidates).toContain(ogre);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [ogre] } }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[evo]!.zone).toBe('exile');
  });
});

import { describe, expect, it } from 'vitest';
import { chars, legalActions, type Action, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * A question about what happened this turn is a kind of happening and a filter, read from the card's words and asked
 * of the turn's history (src/history.ts) — no fact kept for it. These are cards whose question nothing read before the
 * question was read that way, in their own words: Structural Assault, Follow the Bodies (gravestorm, CR 702.69a),
 * Kami of Transience, Miles O'Brien, Sarevok, The Lady of Otaria, Evendo Brushrazer, Vazi and, as it was, Titan Hunter.
 */
const CARDS = [
  makeCard({ name: 'Structural Assault', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all artifacts, then Structural Assault deals damage to each creature equal to the number of artifacts that were put into graveyards from the battlefield this turn.' }),
  makeCard({ name: 'Follow the Bodies', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gravestorm (When you cast this spell, copy it for each permanent put into a graveyard from the battlefield this turn.)\nInvestigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")' }),
  makeCard({ name: 'Kami of Transience', type_line: 'Creature — Spirit', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Trample\nWhenever you cast an enchantment spell, put a +1/+1 counter on this creature.\nAt the beginning of each end step, if an enchantment was put into your graveyard from the battlefield this turn, you may return this card from your graveyard to your hand.' }),
  makeCard({ name: "Miles O'Brien, Transporter Ops", type_line: 'Legendary Creature — Human Artificer', mana_cost: '{2}{W}', cmc: 3, power: '3', toughness: '3', oracle_text: "When Miles O'Brien enters, return up to one other target creature or artifact you control to its owner's hand.\nAt the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card." }),
  makeCard({ name: 'Sarevok, Deathbringer', type_line: 'Legendary Creature — Human Knight', mana_cost: '{3}{B}', cmc: 4, power: '3', toughness: '4', oracle_text: "At the beginning of each player's end step, if no permanents left the battlefield this turn, that player loses X life, where X is Sarevok's power.\nChoose a Background (You can have a Background as a second commander.)" }),
  makeCard({ name: 'The Lady of Otaria', type_line: 'Legendary Creature — Avatar', mana_cost: '{3}{R}{G}', cmc: 5, power: '5', toughness: '5', oracle_text: 'You may tap three untapped Dwarves you control rather than pay this spell\'s mana cost.\nAt the beginning of each end step, if a land you controlled was put into a graveyard from the battlefield this turn, reveal the top four cards of your library. You may put any number of Dwarf cards from among them into your hand. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Evendo Brushrazer', type_line: 'Creature — Insect Warrior', mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '2', oracle_text: "Whenever you sacrifice a nontoken permanent, exile the top card of your library.\nDuring your turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with this creature.\n{T}, Sacrifice a land: Add {R}{R}." }),
  makeCard({ name: 'Vazi, Keen Negotiator', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{2}{B}{R}{G}', cmc: 5, power: '3', toughness: '3', oracle_text: 'Haste\n{T}: Target opponent creates X Treasure tokens, where X is the number of Treasure tokens you created this turn.' }),
  makeCard({ name: 'Titan Hunter', type_line: 'Creature — Human Warrior', mana_cost: '{4}{B}', cmc: 5, power: '4', toughness: '5', oracle_text: "At the beginning of each player's end step, if no creatures died this turn, this creature deals 4 damage to that player.\n{1}{B}, Sacrifice a creature: You gain 4 life." }),
  // Read before, and asked as the turn stood before the spell resolved: one short, each time.
  makeCard({ name: 'Deadly Embrace', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target creature an opponent controls. Then draw a card for each creature that died this turn.' }),
  makeCard({ name: 'Decommission', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact or enchantment.\nRevolt — If a permanent you controlled left the battlefield this turn, you gain 3 life.' }),
  makeCard({ name: 'Flesh Allergy', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nDestroy target creature. Its controller loses life equal to the number of creatures that died this turn.' }),
  // A creature card that isn't a creature while its controller's devotion is short (Erebos's wording).
  makeCard({ name: 'Erebos', type_line: 'Legendary Enchantment Creature — God', mana_cost: '{3}{B}', cmc: 4, power: '5', toughness: '7', oracle_text: "Indestructible\nAs long as your devotion to black is less than five, Erebos isn't a creature." }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Shrine', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target permanent.' }),
  makeCard({ name: 'Recall', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target permanent to its owner's hand." }),
  makeCard({ name: 'Summon', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 white Spirit creature token.' }),
  makeCard({ name: 'Strike Gold', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Treasure token.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (who = 'alice'): GameState => toStep(start({ extra: CARDS }), 'main1', who);
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, player = 'alice') => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...more }));
const named = (g: GameState, sub: string) => g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes(sub));
const zone = (g: GameState, id: string) => g.objects[id]!.zone;

describe('a question about this turn, read from the card and asked of the turn\'s history', () => {
  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });

  it('Structural Assault: "the number of artifacts that were put into graveyards from the battlefield this turn" counts the ones it has just destroyed', () => {
    let g = main();
    const relics = [give(g, 'alice', 'Relic', 'battlefield'), give(g, 'bob', 'Relic', 'battlefield')];
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'Structural Assault');
    // Two artifacts destroyed, so 2 damage to each creature: the 2/2 dies, the 3/3 lives.
    expect(relics.map((id) => zone(g, id))).toEqual(['graveyard', 'graveyard']);
    expect([zone(g, bear), zone(g, ogre)]).toEqual(['graveyard', 'battlefield']);
  });

  it('… and the ones that went there earlier in the turn', () => {
    let g = main();
    const early = give(g, 'bob', 'Relic', 'battlefield');
    g = cast(g, 'Slay', { targets: at(early) });
    give(g, 'alice', 'Relic', 'battlefield');
    give(g, 'bob', 'Relic', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'Structural Assault');
    // One earlier and two now: 3 damage, and the 3/3 dies too.
    expect(zone(g, ogre)).toBe('graveyard');
    // With no artifacts at all, it deals none.
    let h = main();
    const bear = give(h, 'bob', 'Bear', 'battlefield');
    h = cast(h, 'Structural Assault');
    expect(zone(h, bear)).toBe('battlefield');
  });

  it('a question asked as an effect is carried out counts what the spell has already done (CR 608.2h)', () => {
    // Deadly Embrace: the creature it has just destroyed is one that died this turn.
    let g = main();
    const hand = () => g.zones.hand.alice!.length;
    const start = hand();
    g = cast(g, 'Deadly Embrace', { targets: at(give(g, 'bob', 'Bear', 'battlefield')) });
    expect(hand() - start).toBe(1);
    const before = hand();
    g = cast(g, 'Slay', { targets: at(give(g, 'bob', 'Ogre', 'battlefield')) });
    g = cast(g, 'Deadly Embrace', { targets: at(give(g, 'bob', 'Bear', 'battlefield')) });
    // Three have died by then: the first Embrace's, the Ogre, and this one.
    expect(hand() - before).toBe(3);
    // Flesh Allergy: the creature sacrificed to cast it and the one it destroys.
    let h = main();
    const fodder = give(h, 'alice', 'Bear', 'battlefield');
    const target = give(h, 'bob', 'Ogre', 'battlefield');
    const life = h.players.bob!.life;
    h = cast(h, 'Flesh Allergy', { targets: at(target), costs: { sacrifice: [fodder] } });
    expect([zone(h, fodder), zone(h, target), life - h.players.bob!.life]).toEqual(['graveyard', 'graveyard', 2]);
  });

  it('Decommission: destroying a permanent you control "will enable its own revolt ability" (its ruling of 2017-02-09)', () => {
    let g = main();
    const life = g.players.alice!.life;
    g = cast(g, 'Decommission', { targets: at(give(g, 'alice', 'Relic', 'battlefield')) });
    expect(g.players.alice!.life - life).toBe(3);
    // Bob's artifact isn't one she controlled: no revolt, unless something of hers left earlier in the turn.
    let h = main();
    h = cast(h, 'Decommission', { targets: at(give(h, 'bob', 'Relic', 'battlefield')) });
    expect(h.players.alice!.life - life).toBe(0);
    h = cast(h, 'Recall', { targets: at(give(h, 'alice', 'Bear', 'battlefield')) });
    h = cast(h, 'Decommission', { targets: at(give(h, 'bob', 'Shrine', 'battlefield')) });
    expect(h.players.alice!.life - life).toBe(3);
  });

  it('gravestorm (CR 702.69a): a copy for each permanent put into a graveyard from the battlefield this turn — tokens too', () => {
    let g = main();
    g = cast(g, 'Follow the Bodies');
    expect(named(g, 'Clue').length).toBe(1);
    let h = main();
    h = cast(h, 'Slay', { targets: at(give(h, 'bob', 'Bear', 'battlefield')) });
    h = cast(h, 'Summon');
    h = cast(h, 'Slay', { targets: at(h.zones.battlefield.find((id) => h.objects[id]!.token)!) });
    // A permanent returned to its owner's hand wasn't put into a graveyard.
    h = cast(h, 'Recall', { targets: at(give(h, 'bob', 'Ogre', 'battlefield')) });
    h = cast(h, 'Follow the Bodies');
    // The spell and two copies.
    expect(named(h, 'Clue').length).toBe(3);
  });

  it('Kami of Transience: "if an enchantment was put into your graveyard from the battlefield this turn" — yours, and from the battlefield', () => {
    const atEnd = (setup: (g: GameState) => GameState): [GameState, string] => {
      let g = main();
      const kami = give(g, 'alice', 'Kami of Transience', 'graveyard');
      g = settle(toStep(setup(g), 'end', 'alice'));
      return [g, kami];
    };
    let [g, kami] = atEnd((s) => cast(s, 'Slay', { targets: at(give(s, 'alice', 'Shrine', 'battlefield')) }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(zone(g, kami)).toBe('hand');
    // Bob's enchantment went to Bob's graveyard; hers went to her hand; an artifact isn't an enchantment.
    for (const setup of [
      (s: GameState) => cast(s, 'Slay', { targets: at(give(s, 'bob', 'Shrine', 'battlefield')) }),
      (s: GameState) => cast(s, 'Recall', { targets: at(give(s, 'alice', 'Shrine', 'battlefield')) }),
      (s: GameState) => cast(s, 'Slay', { targets: at(give(s, 'alice', 'Relic', 'battlefield')) }),
    ]) {
      [g, kami] = atEnd(setup);
      expect([g.pending, zone(g, kami)]).toEqual([null, 'graveyard']);
    }
  });

  it('Miles O\'Brien: "if a permanent was returned to your hand from the battlefield this turn, draw a card"', () => {
    const drawn = (setup: (g: GameState) => GameState): number => {
      let g = main();
      give(g, 'alice', "Miles O'Brien, Transporter Ops", 'battlefield');
      g = setup(g);
      const hand = g.zones.hand.alice!.length;
      g = settle(toStep(g, 'end', 'alice'));
      return g.zones.hand.alice!.length - hand;
    };
    expect(drawn((s) => cast(s, 'Recall', { targets: at(give(s, 'alice', 'Bear', 'battlefield')) }))).toBe(1);
    // To Bob's hand isn't to hers; into her graveyard isn't to her hand; and nothing at all.
    expect(drawn((s) => cast(s, 'Recall', { targets: at(give(s, 'bob', 'Bear', 'battlefield')) }))).toBe(0);
    expect(drawn((s) => cast(s, 'Slay', { targets: at(give(s, 'alice', 'Bear', 'battlefield')) }))).toBe(0);
    expect(drawn((s) => s)).toBe(0);
  });

  it('Sarevok: "if no permanents left the battlefield this turn, that player loses X life" — any permanent, anyone\'s', () => {
    const lost = (setup: (g: GameState) => GameState): number => {
      let g = main();
      give(g, 'alice', 'Sarevok, Deathbringer', 'battlefield');
      g = setup(g);
      const life = g.players.alice!.life;
      g = settle(toStep(g, 'end', 'alice'));
      return life - g.players.alice!.life;
    };
    expect(lost((s) => s)).toBe(3);
    expect(lost((s) => cast(s, 'Recall', { targets: at(give(s, 'bob', 'Bear', 'battlefield')) }))).toBe(0);
    // A token that left is a permanent that left.
    expect(lost((s) => { const t = cast(s, 'Summon'); return cast(t, 'Slay', { targets: at(t.zones.battlefield.find((id) => t.objects[id]!.token)!) }); })).toBe(0);
  });

  it('The Lady of Otaria: "if a land you controlled was put into a graveyard from the battlefield this turn"', () => {
    const triggers = (setup: (g: GameState) => GameState): boolean => {
      let g = main();
      give(g, 'alice', 'The Lady of Otaria', 'battlefield');
      g = toStep(setup(g), 'end', 'alice');
      return g.stack.some((e) => e.kind === 'ability' && e.sourceName === 'The Lady of Otaria') || g.pending !== null;
    };
    expect(triggers((s) => cast(s, 'Slay', { targets: at(give(s, 'alice', 'Forest', 'battlefield')) }))).toBe(true);
    // Bob's land; her land to her hand; her creature.
    expect(triggers((s) => cast(s, 'Slay', { targets: at(give(s, 'bob', 'Forest', 'battlefield')) }))).toBe(false);
    expect(triggers((s) => cast(s, 'Recall', { targets: at(give(s, 'alice', 'Forest', 'battlefield')) }))).toBe(false);
    expect(triggers((s) => cast(s, 'Slay', { targets: at(give(s, 'alice', 'Bear', 'battlefield')) }))).toBe(false);
  });

  it('Evendo Brushrazer: "as long as you\'ve sacrificed a nontoken permanent this turn, you may play cards exiled with this creature"', () => {
    let g = main();
    const razer = give(g, 'alice', 'Evendo Brushrazer', 'battlefield');
    const land = give(g, 'alice', 'Forest', 'battlefield');
    // (Test setup: a land on top of her library, to be exiled and played.)
    const top = give(g, 'alice', 'Forest', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    const playable = (s: GameState) => legalActions(s, 'alice').some((a) => a.type === 'play_land' && a.object === top);
    g = settle(act(g, { type: 'activate_mana', player: 'alice', object: razer, ability: 0, costs: { sacrifice: [land] } }));
    // Sacrificing a nontoken permanent exiled the top card, and she may play it this turn.
    expect([zone(g, top), playable(g)]).toEqual(['exile', true]);
    // On her next turn she hasn't sacrificed anything: the card is still exiled, and not hers to play.
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect([zone(g, top), playable(g)]).toEqual(['exile', false]);
  });

  it('Vazi: "X Treasure tokens, where X is the number of Treasure tokens you created this turn"', () => {
    let g = main();
    const vazi = give(g, 'alice', 'Vazi, Keen Negotiator', 'battlefield');
    g = cast(g, 'Strike Gold');
    g = cast(g, 'Strike Gold');
    // Not a Treasure; and Bob's own doesn't count for her.
    g = cast(g, 'Summon');
    const treasures = (s: GameState, p: string) => named(s, 'Treasure').filter((id) => s.objects[id]!.controller === p).length;
    expect([treasures(g, 'alice'), treasures(g, 'bob')]).toEqual([2, 0]);
    g = settle(act(g, { type: 'activate', player: 'alice', object: vazi, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(treasures(g, 'bob')).toBe(2);
  });

  it('Titan Hunter: "if no creatures died this turn" — and a creature card that wasn\'t a creature when it died is not one', () => {
    const dealt = (setup: (g: GameState) => GameState): number => {
      let g = main();
      give(g, 'alice', 'Titan Hunter', 'battlefield');
      g = setup(g);
      const life = g.players.alice!.life;
      g = settle(toStep(g, 'end', 'alice'));
      return life - g.players.alice!.life;
    };
    expect(dealt((s) => s)).toBe(4);
    expect(dealt((s) => cast(s, 'Slay', { targets: at(give(s, 'bob', 'Bear', 'battlefield')) }))).toBe(0);
    // An artifact that died is not a creature that died.
    expect(dealt((s) => cast(s, 'Slay', { targets: at(give(s, 'bob', 'Relic', 'battlefield')) }))).toBe(4);
    // CR 700.4, 603.10a: Erebos with too little devotion is an enchantment, not a creature; put into the graveyard from
    // the battlefield (by a manual move here: it is indestructible), no creature died — whatever its card says.
    expect(dealt((s) => {
      const erebos = give(s, 'alice', 'Erebos', 'battlefield');
      expect(chars(s, s.objects[erebos]!).types).toEqual(['Enchantment']);
      return act(s, { type: 'manual', player: 'alice', op: { kind: 'move', object: erebos, to: 'graveyard' } });
    })).toBe(4);
  });
});

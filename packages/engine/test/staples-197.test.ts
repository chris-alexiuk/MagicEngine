import { describe, expect, it } from 'vitest';
import { chars, viewFor } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, actWithEvents, give, makeCard, start, toStep } from './helpers.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Island', type_line: 'Basic Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
  makeCard({ name: 'Wastes Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Dagger Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+0.\nEquip {1}' }),
  makeCard({ name: 'Allied Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Domain — Target player draws a card for each basic land type among lands they control.' }),
  makeCard({ name: 'Creativity Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target player draws cards equal to the number of cards in their hand, then discards that many cards.' }),
  makeCard({ name: 'Seism Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Sacrifice any number of lands, then add that much {C}.' }),
  makeCard({ name: 'Vengeance Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Creatures of the creature type of your choice get -3/-3 until end of turn.' }),
  makeCard({ name: 'Nipper Lite', type_line: 'Creature — Beast', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'This creature enters with your choice of a deathtouch counter or a lifelink counter on it.' }),
  makeCard({ name: 'Newt Lite', type_line: 'Creature — Salamander', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, target creature an opponent controls gets -1/-1 until end of turn. That creature gets -4/-4 instead if you control a creature named Bogbrew Witch.' }),
  makeCard({ name: 'Bogbrew Witch', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Strike Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target creature gets +2/+2 until end of turn. If it's a Warrior, you may attach an Equipment you control to it." }),
  makeCard({ name: 'Warrior Cub', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Burn Away Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Burn Away Lite deals 6 damage to target creature. When that creature dies this turn, exile its controller's graveyard." }),
  makeCard({ name: 'Spires Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Spires Lite deals damage to target creature equal to the number of nonbasic lands that creature's controller controls." }),
  makeCard({ name: 'Cathars Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1. Those creatures gain vigilance until end of turn.' }),
  makeCard({ name: 'Spirit World Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return up to one target creature to its owner\'s hand. Create a 1/1 colorless Spirit creature token with "This token can\'t block or be blocked by non-Spirit creatures."' }),
  makeCard({ name: 'Spirit Cub', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Eon Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Players skip their upkeep steps.' }),
  makeCard({ name: 'Upkeep Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, you gain 1 life.' }),
  makeCard({ name: 'Telepathy Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Your opponents play with their hands revealed.' }),
  makeCard({ name: 'Feaster Lite', type_line: 'Creature — Zombie Cat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "At the beginning of your upkeep, you may exile a creature card from a graveyard. If you do, put a +1/+1 counter on this creature. If you don't, tap this creature." }),
  makeCard({ name: 'Karn Lite', type_line: 'Legendary Planeswalker — Karn', mana_cost: '{0}', loyalty: '5', oracle_text: '+1: Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.\n−1: Put a card you own with a silver counter on it from exile into your hand.' } as never),
  makeCard({ name: 'Murmurs Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Reveal the top three cards of your library. An opponent chooses one of them. Put that card into your graveyard and the rest into your hand.' }),
  makeCard({ name: 'Relic Crush Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact or enchantment and up to one other target artifact or enchantment.' }),
  makeCard({ name: 'Recalibrate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature to its owner's hand. If you've discarded a card this turn, draw a card." }),
  makeCard({ name: 'Rumbler Lite', type_line: 'Creature — Rhino', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Whenever this creature attacks, if it doesn't have first strike, put a first strike counter on it.\nWhenever this creature attacks, if it has first strike, it gains double strike until end of turn." }),
  makeCard({ name: 'Cannonball Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, roll a six-sided die. If the result is 4 or less, this creature deals that much damage to you.' }),
  makeCard({ name: 'Animator Lite', type_line: 'Creature — Human Artificer', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'When this creature enters, target artifact you control becomes an artifact creature with base power and toughness 5/5 for as long as this creature remains on the battlefield.' }),
  makeCard({ name: 'Pulse Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Pulse Lite deals 4 damage to target player or planeswalker. Then if that player or that planeswalker's controller has more life than you, return Pulse Lite to its owner's hand." }),
  makeCard({ name: 'Setback Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'The owner of target spell or nonland permanent puts it on their choice of the top or bottom of their library.' }),
  makeCard({ name: 'Vapor Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: "Defender\nPrevent all damage that would be dealt to this creature by creatures it's blocking." }),
  makeCard({ name: 'Shade Lite', type_line: 'Creature — Shade', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Shatter Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact.' }),
  makeCard({ name: 'Impatience Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each player's end step, if that player didn't cast a spell this turn, this enchantment deals 2 damage to that player." }),
  makeCard({ name: 'Reparations Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever an opponent casts a spell that targets you or a creature you control, you may draw a card.' }),
  makeCard({ name: 'Malfunction Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'All creatures get -2/-2 until end of turn. If a creature would die this turn, exile it instead.' }),
  makeCard({ name: 'Meditator Lite', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Landfall — Whenever a land you control enters, you may have this creature's base power and toughness become 4/2 until end of turn." }),
  makeCard({ name: 'Mountain Lite', type_line: 'Basic Land — Mountain', mana_cost: '', oracle_text: '({T}: Add {R}.)' }),
  makeCard({ name: 'Forest Lite', type_line: 'Basic Land — Forest', mana_cost: '', oracle_text: '({T}: Add {G}.)' }),
  makeCard({ name: 'Merfolk Cub', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Swamp', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Punishment Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player loses life equal to the damage already dealt to that player this turn.' }),
  makeCard({ name: 'Sanction Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt to creatures you control by sources you control.' }),
  makeCard({ name: 'Hubris Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature and all Auras attached to it to their owners' hands." }),
  makeCard({ name: 'Aura Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.' }),
  makeCard({ name: 'Confession Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills four cards. You draw a card for each creature card put into their graveyard this way.' }),
  makeCard({ name: 'Servant Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{3}', power: '2', toughness: '3', oracle_text: 'Adamant — When this creature enters, if at least three mana of the same color was spent to cast it, draw a card.' }),
  makeCard({ name: 'Zealot Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature blocks a creature, destroy both creatures.' }),
  makeCard({ name: 'Cinder Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{1}: Add {B} or {R}. Activate no more than three times each turn.' }),
  makeCard({ name: 'Defeat Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell. If it was a creature spell, scry 2.' }),
  makeCard({ name: 'Spin Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Put target creature on top of its owner's library, then fateseal 2." }),
  makeCard({ name: 'Pack Hunt Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for up to three cards with the same name as target creature, reveal them, put them into your hand, then shuffle.' }),
  makeCard({ name: 'Spores Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Destroy target nonblack creature and target land. They can't be regenerated." }),
  makeCard({ name: 'Regen Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Regenerate target creature.' }),
  makeCard({ name: 'Amnesia Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player reveals their hand and discards all nonland cards.' }),
  makeCard({ name: 'Persecute Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a color. Target player reveals their hand and discards all cards of that color.' }),
  makeCard({ name: 'Red Cub', type_line: 'Creature — Goblin', mana_cost: '{R}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Outwit Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell that targets a player.' }),
  makeCard({ name: 'Bystander Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '2', toughness: '5', oracle_text: 'Whenever this creature is dealt 3 or more damage, investigate.' }),
  makeCard({ name: 'Ping Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Ping Lite deals 2 damage to any target.' }),
  makeCard({ name: 'Vineshaper Lite', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, put a +1/+1 counter on each of up to two target Merfolk you control.' }),
  makeCard({ name: 'Nightcreep Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, all creatures become black and all lands become Swamps.' }),
  makeCard({ name: 'Firespout Lite', type_line: 'Sorcery', mana_cost: '{2}', oracle_text: 'Firespout Lite deals 3 damage to each creature without flying if {R} was spent to cast this spell and 3 damage to each creature with flying if {G} was spent to cast this spell.' }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Istvan Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Prevent all damage that would be dealt to this creature by creatures.' }),
  makeCard({ name: 'Fires Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Fires Lite deals 1 damage to each creature and each planeswalker. If a permanent dealt damage this way would die this turn, exile it instead.' }),
  makeCard({ name: 'Decree Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target creature or planeswalker that's black or red. Scry 1." }),
  makeCard({ name: 'Suspicions Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each opponent's upkeep, that player loses X life, where X is the number of cards in that player's hand minus the number of cards in your hand." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const onTop = (g: GameState, who: string, ids: string[]) => {
  g.zones.library[who] = [...ids, ...g.zones.library[who]!.filter((id) => !ids.includes(id))];
};

describe('staples (slice 270, part 2)', () => {
  it("Allied Strategies counts the target player's basic land types; Laquatus's Creativity discards as many as were drawn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const l of ['Plains', 'Island', 'Wastes Lite']) give(g, 'bob', l, 'battlefield');
    give(g, 'alice', 'Plains', 'battlefield');
    const hand = g.zones.hand.bob!.length;
    g = cast(g, 'alice', 'Allied Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.zones.hand.bob!.length - hand).toBe(2);

    const before = g.zones.hand.bob!.length;
    const yard = g.zones.graveyard.bob!.length;
    g = cast(g, 'alice', 'Creativity Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.pending?.kind).toBe('discard');
    g = choose(g, { kind: 'discard', objects: g.zones.hand.bob!.slice(0, before) });
    expect([g.zones.hand.bob!.length, g.zones.graveyard.bob!.length - yard]).toEqual([before, before]);
  });

  it('Mana Seism adds {C} for each land sacrificed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lands = [give(g, 'alice', 'Plains', 'battlefield'), give(g, 'alice', 'Island', 'battlefield'), give(g, 'alice', 'Wastes Lite', 'battlefield')];
    g = cast(g, 'alice', 'Seism Lite');
    g = choose(g, { kind: 'choose_objects', objects: lands.slice(0, 2) });
    expect([lands.map((id) => g.objects[id]!.zone), g.players.alice!.pool.C]).toEqual([['graveyard', 'graveyard', 'battlefield'], 2]);
  });

  it("Witch's Vengeance: the type is chosen as it resolves", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Vengeance Lite');
    expect(g.pending?.kind).toBe('choose_option');
    g = choose(g, { kind: 'choose_option', choice: 'Bear' });
    expect([...cubs, ogre].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);
  });

  it('Boot Nipper enters with the counter of your choice', () => {
    for (const counter of ['deathtouch', 'lifelink']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const n = give(g, 'alice', 'Nipper Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: n }));
      const p = g.pending as { kind: string; options?: string[] };
      expect([p.kind, p.options]).toEqual(['as_enters', ['deathtouch', 'lifelink']]);
      g = choose(g, { kind: 'as_enters', choice: counter });
      expect([g.objects[n]!.counters[counter], chars(g, g.objects[n]!).keywords.map((k) => k.id)]).toEqual([1, [counter]]);
    }
  });

  it('Festering Newt: -4/-4 instead with Bogbrew Witch', () => {
    for (const witch of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const newt = give(g, 'alice', 'Newt Lite', 'battlefield');
      if (witch) give(g, 'alice', 'Bogbrew Witch', 'battlefield');
      const ogre = give(g, 'bob', 'Ogre', 'battlefield');
      g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: newt }]] });
      if (g.pending?.kind === 'trigger_targets') g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] });
      const c = chars(g, g.objects[ogre]!);
      expect(witch ? g.objects[ogre]!.zone : [c.power, c.toughness]).toEqual(witch ? 'graveyard' : [4, 2]);
    }
  });

  it('Resolute Strike attaches an Equipment you control only to a Warrior', () => {
    for (const who of ['Warrior Cub', 'Cub']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const c = give(g, 'alice', who, 'battlefield');
      const dagger = give(g, 'alice', 'Dagger Lite', 'battlefield');
      g = cast(g, 'alice', 'Strike Lite', { targets: [[{ kind: 'object', object: c }]] });
      if (who === 'Warrior Cub') {
        expect(g.pending?.kind).toBe('may');
        g = choose(g, { kind: 'may', yes: true });
        expect((g.pending as { candidates: string[] }).candidates).toEqual([dagger]);
        g = choose(g, { kind: 'choose_objects', objects: [dagger] });
      }
      expect(g.pending).toBeNull();
      expect([g.objects[dagger]!.attachedTo?.id, chars(g, g.objects[c]!).power]).toEqual(who === 'Cub' ? [undefined, 3] : [c, 4]);
    }
  });

  it("Burn Away exiles the dead creature's controller's graveyard", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    give(g, 'bob', 'Cub', 'graveyard');
    const mine = give(g, 'alice', 'Cub', 'graveyard');
    g = cast(g, 'alice', 'Burn Away Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    expect([g.zones.graveyard.bob!.length, g.objects[ogre]!.zone, g.objects[mine]!.zone]).toEqual([0, 'exile', 'graveyard']);
  });

  it("Weight of Spires counts the creature's controller's nonbasic lands", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Wastes Lite', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    give(g, 'alice', 'Wastes Lite', 'battlefield');
    g = cast(g, 'alice', 'Spires Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const o2 = give(h, 'bob', 'Ogre', 'battlefield');
    for (let i = 0; i < 2; i++) give(h, 'bob', 'Wastes Lite', 'battlefield');
    for (let i = 0; i < 3; i++) give(h, 'alice', 'Wastes Lite', 'battlefield');
    h = cast(h, 'alice', 'Spires Lite', { targets: [[{ kind: 'object', object: o2 }]] });
    expect([h.objects[o2]!.zone, h.objects[o2]!.damage]).toEqual(['battlefield', 2]);
  });

  it('Arm the Cathars: each target gets its pump and vigilance', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b, c] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    g = cast(g, 'alice', 'Cathars Lite', { targets: [[{ kind: 'object', object: a }], [{ kind: 'object', object: b }], [{ kind: 'object', object: c }]] });
    const stats = [a, b, c].map((id) => {
      const x = chars(g, g.objects[id]!);
      return [x.power, x.keywords.some((k) => k.id === 'vigilance')];
    });
    expect(stats).toEqual([[4, true], [3, true], [6, true]]);
  });

  it("Lost in the Spirit World's token can't block or be blocked by non-Spirits", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = cast(g, 'alice', 'Spirit World Lite', { targets: [[]] });
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g.objects[token]!.sick = false;
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const spirit = give(g, 'bob', 'Spirit Cub', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: token, target: { kind: 'player', player: 'bob' } }] } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(g.pending?.kind).toBe('declare_blockers');
    const r = (blocker: string) => {
      try {
        act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: token }] } } as never);
        return true;
      } catch {
        return false;
      }
    };
    expect([r(cub), r(spirit)]).toEqual([false, true]);
  });

  it('Eon Hub: players skip their upkeep steps; Telepathy reveals the opponents\' hands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Upkeep Lite', 'battlefield');
    const hub = give(g, 'alice', 'Eon Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = toStep(g, 'main1', 'alice');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.players.alice!.life).toBe(life);
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== hub);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.players.alice!.life).toBe(life + 1);

    const h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    expect(typeof viewFor(h, 'alice').zones.hand.bob).toBe('number');
    give(h, 'alice', 'Telepathy Lite', 'battlefield');
    expect([Array.isArray(viewFor(h, 'alice').zones.hand.bob), typeof viewFor(h, 'bob').zones.hand.alice]).toEqual([true, 'number']);
  });

  it("Entrails Feaster exiles a creature card from any graveyard, or taps itself", () => {
    for (const card of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const f = give(g, 'alice', 'Feaster Lite', 'battlefield');
      g = toStep(g, 'upkeep', 'alice');
      // Only the card the test puts there (discards to hand size on the way could have put others).
      for (const p of ['alice', 'bob']) for (const id of g.zones.graveyard[p]!) moveObject(g, id, 'exile', []);
      const theirs = card ? give(g, 'bob', 'Ogre', 'graveyard') : null;
      g = settle(g);
      if (card) {
        expect(g.pending?.kind).toBe('may');
        g = choose(g, { kind: 'may', yes: true });
        if (g.pending?.kind === 'choose_objects') g = choose(g, { kind: 'choose_objects', objects: [theirs] });
      }
      expect([g.objects[f]!.counters['+1/+1'], g.objects[f]!.tapped, theirs && g.objects[theirs]!.zone]).toEqual(card ? [1, false, 'exile'] : [undefined, true, null]);
    }
  });

  it('Karn, Scion of Urza: an opponent chooses; the other is exiled with a silver counter and comes back with −1', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const karn = give(g, 'alice', 'Karn Lite', 'battlefield');
    g.objects[karn]!.counters.loyalty = 5;
    const [x, y] = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Ogre', 'library')];
    onTop(g, 'alice', [x, y]);
    g = settle(act(g, { type: 'activate', player: 'alice', object: karn, ability: 0 }));
    expect(g.pending?.kind).toBe('choose_option');
    g = choose(g, { kind: 'choose_option', choice: 'carol' });
    const p = g.pending as { kind: string; player: string; candidates: string[]; revealed?: string[] };
    expect([p.kind, p.player, p.candidates, p.revealed]).toEqual(['choose_objects', 'carol', [x, y], [x, y]]);
    g = choose(g, { kind: 'choose_objects', objects: [x] });
    expect([g.objects[x]!.zone, g.objects[y]!.zone, g.objects[y]!.counters.silver]).toEqual(['hand', 'exile', 1]);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'activate', player: 'alice', object: karn, ability: 1 }));
    expect(g.objects[y]!.zone).toBe('hand');
  });

  it('Murmurs from Beyond: the chosen card to the graveyard, the rest to your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Ogre', 'library'), give(g, 'alice', 'Plains', 'library')];
    onTop(g, 'alice', top);
    g = cast(g, 'alice', 'Murmurs Lite');
    expect((g.pending as { player: string }).player).toBe('bob');
    g = choose(g, { kind: 'choose_objects', objects: [top[1]] });
    expect(top.map((id) => g.objects[id]!.zone)).toEqual(['hand', 'graveyard', 'hand']);
  });

  it('Relic Crush and Arm the Cathars: "other target" must be a different object', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [d1, d2] = [give(g, 'bob', 'Dagger Lite', 'battlefield'), give(g, 'bob', 'Dagger Lite', 'battlefield')];
    const spell = give(g, 'alice', 'Relic Crush Lite', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: d1 }], [{ kind: 'object', object: d1 }]] })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: d1 }], [{ kind: 'object', object: d2 }]] }));
    expect([d1, d2].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const c2 = give(g, 'alice', 'Cathars Lite', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: c2, targets: [[{ kind: 'object', object: cub }], [{ kind: 'object', object: cub }], []] })).toThrow();
  });

  it("Recalibrate draws only if you've discarded a card this turn", () => {
    for (const discarded of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (discarded) g.turnLog.discarded = [{ id: 'x', zcc: 0, player: 'alice' }] as never;
      const ogre = give(g, 'bob', 'Ogre', 'battlefield');
      const hand = g.zones.hand.alice!.length;
      g = cast(g, 'alice', 'Recalibrate Lite', { targets: [[{ kind: 'object', object: ogre }]] });
      expect([g.objects[ogre]!.zone, g.zones.hand.alice!.length - hand]).toEqual(['hand', discarded ? 1 : 0]);
    }
  });

  it('Momentum Rumbler: a first strike counter, then double strike on later attacks', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const r = give(g, 'alice', 'Rumbler Lite', 'battlefield');
    const attack = (x: GameState) => {
      x = toStep(x, 'beginning_of_combat', 'alice');
      while (!x.pending && x.priority) x = act(x, { type: 'pass', player: x.priority });
      return settle(act(x, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: r, target: { kind: 'player', player: 'bob' } }] } }));
    };
    g = attack(g);
    expect([g.objects[r]!.counters.first_strike, chars(g, g.objects[r]!).keywords.some((k) => k.id === 'double_strike')]).toEqual([1, false]);
    g = toStep(g, 'main1', 'bob');
    g = attack(g);
    expect([g.objects[r]!.counters.first_strike, chars(g, g.objects[r]!).keywords.some((k) => k.id === 'double_strike')]).toEqual([1, true]);
  });

  it('Non-Human Cannonball deals the result to you if it is 4 or less', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let g = toStep(start({ extra: CARDS, seed }), 'main1', 'alice');
      const life = g.players.alice!.life;
      const c = give(g, 'alice', 'Cannonball Lite', 'battlefield');
      const { state, events } = actWithEvents(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: c }]] } as never);
      void events;
      g = state;
      let rolled = 0;
      for (let i = 0; i < 20 && g.stack.length && !g.pending; i++) {
        const r = actWithEvents(g, { type: 'pass', player: g.priority! });
        g = r.state;
        for (const e of r.events) if (e.type === 'die_rolled') rolled = e.result;
      }
      expect(rolled).toBeGreaterThan(0);
      expect(life - g.players.alice!.life).toBe(rolled <= 4 ? rolled : 0);
    }
  });

  it('Skilled Animator: the artifact is a 5/5 for as long as the Animator remains on the battlefield', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dagger = give(g, 'alice', 'Dagger Lite', 'battlefield');
    const animator = give(g, 'alice', 'Animator Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: animator }));
    if (g.pending?.kind === 'trigger_targets') g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: dagger }]] });
    let c = chars(g, g.objects[dagger]!);
    expect([c.types, c.power]).toEqual([['Artifact', 'Creature'], 5]);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[dagger]!).power).toBe(5);
    g = cast(g, 'bob', 'Bolt', { targets: [[{ kind: 'object', object: animator }]] });
    c = chars(g, g.objects[dagger]!);
    expect([g.objects[animator]!.zone, c.types]).toEqual(['graveyard', ['Artifact']]);
  });

  it('Pulse of the Forge returns to hand only if that player has more life than you', () => {
    for (const more of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      g.players.bob!.life = more ? 30 : 10;
      const p = give(g, 'alice', 'Pulse Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: p, targets: [[{ kind: 'player', player: 'bob' }]] }));
      expect([g.players.bob!.life, g.objects[p]!.zone]).toEqual([more ? 26 : 6, more ? 'hand' : 'graveyard']);
    }
  });

  it('Sudden Setback: the owner of a target spell puts it on the top or bottom of their library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: ogre });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Setback Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'pass', player: 'alice' });
    const p = g.pending as { kind: string; player: string; options: string[] };
    expect([p.kind, p.player, p.options]).toEqual(['choose_option', 'alice', ['top', 'bottom']]);
    g = choose(g, { kind: 'choose_option', choice: 'top' });
    expect([g.objects[ogre]!.zone, g.zones.library.alice![0], g.stack.length]).toEqual(['library', ogre, 0]);
  });

  it("Wall of Vapor: damage from creatures it's blocking is prevented", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const wall = give(g, 'alice', 'Vapor Lite', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'bob');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'alice' } }] } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: ogre }] } });
    g = toStep(g, 'main2', 'bob');
    expect([g.objects[wall]!.zone, g.objects[wall]!.damage]).toEqual(['battlefield', 0]);
  });
});

describe('staples (slice 270, part 3)', () => {
  it('Ichor Shade: an artifact put into a graveyard from the battlefield counts', () => {
    for (const killed of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const shade = give(g, 'alice', 'Shade Lite', 'battlefield');
      const dagger = give(g, 'bob', 'Dagger Lite', 'battlefield');
      if (killed) g = cast(g, 'alice', 'Shatter Lite', { targets: [[{ kind: 'object', object: dagger }]] });
      g = toStep(g, 'main1', 'bob');
      expect(g.objects[shade]!.counters['+1/+1']).toBe(killed ? 1 : undefined);
    }
  });

  it("Impatience: damage to a player who didn't cast a spell this turn", () => {
    for (const casts of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Impatience Lite', 'battlefield');
      const life = g.players.alice!.life;
      if (casts) g = cast(g, 'alice', 'Cub');
      g = toStep(g, 'main1', 'bob');
      expect(life - g.players.alice!.life).toBe(casts ? 0 : 2);
    }
  });

  it('Reparations: an opponent targeting you or your creature', () => {
    for (const target of ['player', 'creature', 'other']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Reparations Lite', 'battlefield');
      const mine = give(g, 'alice', 'Cub', 'battlefield');
      const theirs = give(g, 'bob', 'Cub', 'battlefield');
      const t = target === 'player' ? { kind: 'player', player: 'alice' } : { kind: 'object', object: target === 'creature' ? mine : theirs };
      g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[t]] } as never);
      expect(g.stack.length).toBe(target === 'other' ? 1 : 2);
      for (let i = 0; i < 6 && !g.pending && g.stack.length > 1; i++) g = act(g, { type: 'pass', player: g.priority! });
      expect(g.pending?.kind === 'may').toBe(target !== 'other');
    }
  });

  it('Dark Suspicions: their hand minus yours, never less than 0', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Suspicions Lite', 'battlefield');
    g.zones.hand.alice = g.zones.hand.alice!.slice(0, 2);
    const life = g.players.bob!.life;
    g = settle(toStep(g, 'upkeep', 'bob'));
    expect(life - g.players.bob!.life).toBe(g.zones.hand.bob!.length - 2);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Suspicions Lite', 'battlefield');
    h.zones.hand.bob = [];
    const before = h.players.bob!.life;
    h = settle(toStep(h, 'upkeep', 'bob'));
    expect(h.players.bob!.life).toBe(before);
  });

  it('Malicious Malfunction: any creature that would die this turn is exiled instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Malfunction Lite');
    expect(g.objects[cub]!.zone).toBe('exile');
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: ogre }]] });
    expect(g.objects[ogre]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    const later = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'bob', 'Bolt', { targets: [[{ kind: 'object', object: later }]] });
    expect(g.objects[later]!.zone).toBe('graveyard');
  });

  it("Mirkwood Meditator: you may have its base power and toughness become 4/2", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Meditator Lite', 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains', 'hand') } as never));
    expect(g.pending?.kind).toBe('may');
    g = choose(g, { kind: 'may', yes: true });
    const c = chars(g, g.objects[m]!);
    expect([c.power, c.toughness]).toEqual([4, 2]);
  });
});

describe('staples (slice 271)', () => {
  it('Final Punishment: life equal to the damage already dealt to that player this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'player', player: 'bob' }]] });
    g = cast(g, 'alice', 'Punishment Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.players.bob!.life).toBe(20 - 6);
  });

  it('Light of Sanction prevents damage your sources would deal to your creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Sanction Lite', 'battlefield');
    const [mine, theirs] = [give(g, 'alice', 'Ogre', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: mine }]] });
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: theirs }]] });
    expect([g.objects[mine]!.damage, g.objects[theirs]!.zone]).toEqual([0, 'graveyard']);
  });

  it('Hubris returns the creature and its Auras', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Aura Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    const enchanting = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Aura Lite')!;
    expect(g.objects[enchanting]!.attachedTo?.id).toBe(ogre);
    g = cast(g, 'alice', 'Hubris Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    expect([g.objects[ogre]!.zone, g.objects[enchanting]!.zone]).toEqual(['hand', 'hand']);
  });

  it('Coerced Confession draws for each creature card milled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = [give(g, 'bob', 'Ogre', 'library'), give(g, 'bob', 'Plains', 'library'), give(g, 'bob', 'Cub', 'library'), give(g, 'bob', 'Island', 'library')];
    onTop(g, 'bob', top);
    const hand = g.zones.hand.alice!.length;
    g = cast(g, 'alice', 'Confession Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.zones.hand.alice!.length - hand).toBe(2);
  });

  it('Clockwork Servant: adamant needs three mana of one color', () => {
    for (const lands of [['Plains', 'Plains', 'Plains'], ['Plains', 'Island', 'Swamp']]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const l of lands) give(g, 'alice', l, 'battlefield');
      const hand = g.zones.hand.alice!.length;
      g = cast(g, 'alice', 'Servant Lite', { autoTap: true });
      expect(g.zones.hand.alice!.length - hand).toBe(lands[1] === 'Plains' ? 1 : 0);
    }
  });

  it('Alaborn Zealot destroys itself and the creature it blocks', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const z = give(g, 'alice', 'Zealot Lite', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'bob');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'alice' } }] } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: z, attacker: ogre }] } }));
    expect([g.objects[z]!.zone, g.objects[ogre]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('Manaforge Cinder: no more than three activations each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const c = give(g, 'alice', 'Cinder Lite', 'battlefield');
    g.players.alice!.pool.C = 4;
    for (let i = 0; i < 3; i++) g = act(g, { type: 'activate_mana', player: 'alice', object: c, ability: 0, choice: 1 } as never);
    expect(g.players.alice!.pool.R).toBe(3);
    expect(() => act(g, { type: 'activate_mana', player: 'alice', object: c, ability: 0, choice: 1 } as never)).toThrow();
  });

  it('Jace\'s Defeat: scry if the countered spell was of that kind', () => {
    for (const creature of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const spell = give(g, 'alice', creature ? 'Ogre' : 'Bolt', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: spell, ...(creature ? {} : { targets: [[{ kind: 'player', player: 'bob' }]] }) } as never);
      g = act(g, { type: 'pass', player: 'alice' });
      g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Defeat Lite', 'hand'), targets: [[{ kind: 'object', object: spell }]] }));
      expect([g.objects[spell]!.zone, g.pending?.kind ?? null]).toEqual(['graveyard', creature ? 'scry' : null]);
    }
  });

  it("Spin into Myth: then fateseal 2 — an opponent's library, put on the bottom or not", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Spin Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    const p = g.pending as { kind: string; player: string; objects: string[] };
    expect([p.kind, p.player, p.objects[0]]).toEqual(['scry', 'alice', ogre]);
    g = choose(g, { kind: 'scry', top: [p.objects[1]!], bottom: [ogre] });
    const lib = g.zones.library.bob!;
    expect([lib[lib.length - 1], g.zones.library.alice!.includes(ogre)]).toEqual([ogre, false]);
  });

  it('Pack Hunt finds cards with the same name as the target creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const mine = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Cub', 'library')];
    g = cast(g, 'alice', 'Pack Hunt Lite', { targets: [[{ kind: 'object', object: cub }]] });
    const p = g.pending as { kind: string; candidates: string[] };
    expect(p.kind).toBe('search');
    expect(p.candidates.every((id) => g.objects[id]!.card === 'Cub')).toBe(true);
    expect(p.candidates).toEqual(expect.arrayContaining(mine));
  });

  it("Plague Spores: neither can be regenerated", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const land = give(g, 'bob', 'Plains', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spores Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }], [{ kind: 'object', object: land }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Regen Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect([g.objects[ogre]!.zone, g.objects[land]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('Amnesia and Persecute: reveal the hand, discard all of a kind', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.hand.bob = [];
    const cards = [give(g, 'bob', 'Ogre', 'hand'), give(g, 'bob', 'Plains', 'hand'), give(g, 'bob', 'Red Cub', 'hand')];
    g = cast(g, 'alice', 'Persecute Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    g = choose(g, { kind: 'choose_option', choice: 'R' });
    const p = g.pending as { kind: string; revealed?: string[] };
    expect([p.kind, p.revealed]).toEqual(['choose_objects', cards]);
    g = choose(g, { kind: 'choose_objects', objects: [] });
    expect(cards.map((id) => g.objects[id]!.zone)).toEqual(['hand', 'hand', 'graveyard']);
    g = cast(g, 'alice', 'Amnesia Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    g = choose(g, { kind: 'choose_objects', objects: [] });
    expect(cards.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'hand', 'graveyard']);
  });

  it('Outwit counters only a spell that targets a player', () => {
    for (const atPlayer of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const cub = give(g, 'bob', 'Cub', 'battlefield');
      const bolt = give(g, 'alice', 'Bolt', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[atPlayer ? { kind: 'player', player: 'bob' } : { kind: 'object', object: cub }]] } as never);
      g = act(g, { type: 'pass', player: 'alice' });
      const outwit = give(g, 'bob', 'Outwit Lite', 'hand');
      const r = (() => {
        try {
          return act(g, { type: 'cast', player: 'bob', object: outwit, targets: [[{ kind: 'object', object: bolt }]] });
        } catch {
          return null;
        }
      })();
      expect(r !== null).toBe(atPlayer);
    }
  });

  it('Innocent Bystander: only 3 or more damage at once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const b = give(g, 'alice', 'Bystander Lite', 'battlefield');
    const clues = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length;
    g = cast(g, 'alice', 'Ping Lite', { targets: [[{ kind: 'object', object: b }]] });
    expect(clues()).toBe(0);
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: b }]] });
    expect(clues()).toBe(1);
  });

  it('Vineshaper Mystic: up to two target Merfolk', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Merfolk Cub', 'battlefield');
    const v = give(g, 'alice', 'Vineshaper Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: v }));
    g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: m }, { kind: 'object', object: v }]] });
    expect([g.objects[m]!.counters['+1/+1'], g.objects[v]!.counters['+1/+1']]).toEqual([1, 1]);
  });

  it('Nightcreep: creatures black and lands Swamps until end of turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const land = give(g, 'bob', 'Plains', 'battlefield');
    g = cast(g, 'alice', 'Nightcreep Lite');
    expect([chars(g, g.objects[cub]!).colors, chars(g, g.objects[land]!).subtypes]).toEqual([['B'], ['Swamp']]);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[land]!).subtypes).toEqual(['Plains']);
  });

  it('Firespout: which creatures depends on the colors spent', () => {
    for (const lands of [['Mountain Lite', 'Island'], ['Forest Lite', 'Island']]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const l of lands) give(g, 'alice', l, 'battlefield');
      const [walker, flier] = [give(g, 'bob', 'Cub', 'battlefield'), give(g, 'bob', 'Bird Lite', 'battlefield')];
      g = cast(g, 'alice', 'Firespout Lite', { autoTap: true });
      expect([g.objects[walker]!.zone, g.objects[flier]!.zone]).toEqual(lands[0] === 'Mountain Lite' ? ['graveyard', 'battlefield'] : ['battlefield', 'graveyard']);
    }
  });

  it('Uncle Istvan: damage from creatures is prevented, not from spells', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const i = give(g, 'alice', 'Istvan Lite', 'battlefield');
    g = cast(g, 'alice', 'Ping Lite', { targets: [[{ kind: 'object', object: i }]] });
    expect(g.objects[i]!.damage).toBe(2);
  });

  it('Underworld Fires: only permanents it dealt damage to are exiled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const istvan = give(g, 'alice', 'Istvan Lite', 'battlefield');
    g = cast(g, 'alice', 'Fires Lite');
    expect(g.objects[cub]!.zone).toBe('exile');
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: ogre }]] });
    expect(g.objects[ogre]!.zone).toBe('exile');
    void istvan;
  });

  it("Devout Decree: target creature or planeswalker that's black or red", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [red, green] = [give(g, 'bob', 'Red Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const d = give(g, 'alice', 'Decree Lite', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: d, targets: [[{ kind: 'object', object: green }]] })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: d, targets: [[{ kind: 'object', object: red }]] }));
    expect(g.objects[red]!.zone).toBe('exile');
  });
});

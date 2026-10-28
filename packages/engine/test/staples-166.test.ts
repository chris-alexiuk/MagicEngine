import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Thrasios', type_line: 'Legendary Creature — Merfolk Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: '{4}: Scry 1, then reveal the top card of your library. If it\'s a land card, put it onto the battlefield tapped. Otherwise, draw a card.' }),
  makeCard({ name: 'Nylea', type_line: 'Legendary Enchantment Creature — God', mana_cost: '{0}', power: '5', toughness: '6', oracle_text: '{2}{G}: Reveal the top card of your library. If it\'s a creature card, put it into your hand. Otherwise, you may put it into your graveyard.' }),
  makeCard({ name: 'Yuriko', type_line: 'Legendary Creature — Human Ninja', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever a Ninja you control deals combat damage to a player, reveal the top card of your library and put that card into your hand. Each opponent loses life equal to that card\'s mana value.' }),
  makeCard({ name: 'Fomori Vault', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control. Put one of those cards into your hand and the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Karumonix', type_line: 'Legendary Creature — Rat', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When Karumonix enters, look at the top five cards of your library. You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Genesis Ultimatum', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Look at the top five cards of your library. Put any number of permanent cards from among them onto the battlefield and the rest into your hand. Exile Genesis Ultimatum.' }),
  makeCard({ name: 'Worldsire', type_line: 'Creature — Worm', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "When this creature enters, look at the top X cards of your library, where X is this creature's power. Put any number of land cards from among them onto the battlefield tapped, then shuffle." }),
  makeCard({ name: 'Takenuma', type_line: 'Legendary Land', oracle_text: '{T}: Add {B}.\nChannel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand. This ability costs {1} less to activate for each legendary creature you control.' }),
  makeCard({ name: 'Gemstone Caverns', type_line: 'Legendary Land', oracle_text: "If this card is in your opening hand and you're not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color." }),
  makeCard({ name: 'Rat', type_line: 'Creature — Rat', mana_cost: '{1}', cmc: 1, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{R}', cmc: 1, colors: ['R'], oracle_text: 'Shock deals 2 damage to any target.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toTop = (g: GameState, p: string, ids: string[]) => {
  const lib = g.zones.library[p]!;
  for (const id of [...ids].reverse()) {
    if (lib.includes(id)) lib.splice(lib.indexOf(id), 1);
    lib.unshift(id);
  }
};
const isLand = (g: GameState, id: string) => chars(g, g.objects[id]!).types.includes('Land');

describe('staples (slice 166)', () => {
  it('Thrasios: a land onto the battlefield, anything else drawn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const thrasios = give(g, 'alice', 'Thrasios', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'library');
    toTop(g, 'alice', [bear]);
    const answerScry = () => {
      if (g.pending?.kind === 'scry') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [...(g.pending as { objects: string[] }).objects], bottom: [] } } as never);
    };
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'activate', player: 'alice', object: thrasios, ability: 0 }));
    answerScry();
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('hand');
    const land = g.zones.library.alice!.find((id) => isLand(g, id))!;
    toTop(g, 'alice', [land]);
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'activate', player: 'alice', object: thrasios, ability: 0 }));
    answerScry();
    g = settle(g);
    expect(g.objects[land]!.zone).toBe('battlefield');
    expect(g.objects[land]!.tapped).toBe(true);
  });

  it('Nylea, Keen-Eyed: a creature to your hand, anything else may go to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const nylea = give(g, 'alice', 'Nylea', 'battlefield');
    const relic = give(g, 'alice', 'Relic', 'library');
    toTop(g, 'alice', [relic]);
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: nylea, ability: 0 }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [relic] } }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
  });

  it('Yuriko: each opponent loses life equal to the revealed card’s mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const yuriko = give(g, 'alice', 'Yuriko', 'battlefield');
    g.objects[yuriko]!.sick = false;
    const relic = give(g, 'alice', 'Relic', 'library');
    toTop(g, 'alice', [relic]);
    const life = g.players.bob!.life;
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: yuriko, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'end_of_combat'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[relic]!.zone).toBe('hand');
    // 1 combat damage, then 3 for the Relic.
    expect(g.players.bob!.life).toBe(life - 4);
  });

  it('Fomori Vault: X is the number of artifacts you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vault = give(g, 'alice', 'Fomori Vault', 'battlefield');
    give(g, 'alice', 'Relic', 'battlefield');
    give(g, 'alice', 'Relic', 'battlefield');
    const top = g.zones.library.alice!.slice(0, 4);
    g.players.alice!.pool.C = 3;
    const discard = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 0, costs: { discard: [discard] } }));
    expect(g.pending?.kind).toBe('choose_objects');
    // Three artifacts: the top three cards.
    expect((g.pending as { candidates: string[] }).candidates).toEqual(top.slice(0, 3));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[1]!] } }));
    expect(g.objects[top[1]!]!.zone).toBe('hand');
    expect(g.zones.library.alice![0]).toBe(top[3]);
  });

  it('Karumonix: any number of Rats', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rats = [0, 1].map(() => give(g, 'alice', 'Rat', 'library'));
    const bear = give(g, 'alice', 'Bear', 'library');
    toTop(g, 'alice', [rats[0]!, bear, rats[1]!]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Karumonix', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    expect((g.pending as { candidates: string[] }).candidates).toEqual(rats);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: rats } }));
    for (const id of rats) expect(g.objects[id]!.zone).toBe('hand');
    expect(g.objects[bear]!.zone).toBe('library');
  });

  it('Genesis Ultimatum: permanents onto the battlefield, the rest into your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'library');
    const shock = give(g, 'alice', 'Shock', 'library');
    const relic = give(g, 'alice', 'Relic', 'library');
    toTop(g, 'alice', [bear, shock, relic]);
    const top5 = g.zones.library.alice!.slice(0, 5);
    const ult = give(g, 'alice', 'Genesis Ultimatum', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ult }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear, relic] } }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[relic]!.zone).toBe('battlefield');
    expect(g.objects[shock]!.zone).toBe('hand');
    for (const id of top5.slice(3)) expect(g.objects[id]!.zone).toBe('hand');
    expect(g.objects[ult]!.zone).toBe('exile');
  });

  it('Famished Worldsire: lands from the top X onto the battlefield tapped, then shuffle', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.alice!.slice(0, 3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Worldsire', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    expect((g.pending as { candidates: string[] }).candidates).toEqual(top.filter((id) => isLand(g, id)));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: top.slice(0, 2) } }));
    for (const id of top.slice(0, 2)) {
      expect(g.objects[id]!.zone).toBe('battlefield');
      expect(g.objects[id]!.tapped).toBe(true);
    }
  });

  it('Takenuma: mill three, then a creature or planeswalker card back (cheaper per legend)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const takenuma = give(g, 'alice', 'Takenuma', 'hand');
    give(g, 'alice', 'Thrasios', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    give(g, 'alice', 'Relic', 'graveyard');
    // {3}{B} less {1} for one legendary creature.
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: takenuma, ability: 0 }));
    expect(g.objects[takenuma]!.zone).toBe('graveyard');
    // The Bear is the only creature (the milled cards are Forests).
    expect(g.objects[bear]!.zone).toBe('hand');
  });

  it('Gemstone Caverns: on the battlefield with a luck counter if not the starting player, exiling a card', () => {
    let g = start({ extra: CARDS, mulligan: true, decks: { alice: Array.from({ length: 40 }, () => 'Gemstone Caverns'), bob: Array.from({ length: 40 }, () => 'Gemstone Caverns') } });
    while (g.pending?.kind === 'mulligan') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } });
    // Alice starts: only Bob may use it.
    expect(g.pending).toMatchObject({ kind: 'opening_battlefield', player: 'bob' });
    const [caverns, other] = g.zones.hand.bob!;
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'opening_battlefield', objects: [caverns!] } })).toThrow();
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'opening_battlefield', objects: [caverns!], exile: [other!] } });
    expect(g.objects[caverns!]!.zone).toBe('battlefield');
    expect(g.objects[caverns!]!.counters.luck).toBe(1);
    expect(g.objects[other!]!.zone).toBe('exile');
    // With the luck counter, any color.
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'activate_mana', player: 'bob', object: caverns!, ability: 0, choice: 'R' });
    expect(g.players.bob!.pool.R).toBe(1);
  });

  it('Gemstone Caverns: without the counter, colorless', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const caverns = give(g, 'alice', 'Gemstone Caverns', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: caverns, ability: 0, choice: 'R' });
    expect(g.players.alice!.pool.R ?? 0).toBe(0);
    expect(g.players.alice!.pool.C).toBe(1);
  });
});

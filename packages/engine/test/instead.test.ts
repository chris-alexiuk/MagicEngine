import { describe, expect, it } from 'vitest';
import { OrderNeeded, deciding, lookingAhead, replaced, type Move, type Replacement, type Rules } from '../src/instead.js';
import { MOVE_RULES } from '../src/instead-moves.js';
import { apply, foresee, viewFor, type GameEvent, type GameState, type PendingChoice, type PlayerId, type ZoneName } from '../src/index.js';
import { act, actWithEvents, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// One path for "instead" (CR 614–616): every replacement effect on a card changing zones is a rule in a table, the
// mover puts each move to all of them, and where several apply and the order matters, the affected player chooses.

// ---------------------------------------------------------------------------
// The path itself, with rules made up for the purpose
// ---------------------------------------------------------------------------

describe('replacement effects on one happening', () => {
  const g = start();
  const o = g.objects[give(g, 'alice', 'Grizzly Bears', 'battlefield')]!;
  const dying: Move = { kind: 'move', object: o, from: 'battlefield', to: 'graveyard', also: [] };
  const about = () => ({ text: 'Which first?', sourceName: 'Bear' });
  /** A rule: applies while the move goes to `when`, and sends it to `to` (with a mark, if any). */
  const rule =
    (key: string, when: ZoneName, to: ZoneName, mark?: string, first?: Replacement<Move>['first']) =>
    (_g: GameState, h: Move): Replacement<Move>[] =>
      h.to === when ? [{ key, label: key, ...(first ? { first } : {}), apply: (m) => ({ ...m, to, also: [...m.also, ...(mark ? [{ key: mark, run: () => {} }] : [])] }) }] : [];
  const marks = (m: Move | null) => m?.also.map((a) => a.key);
  const run = (rules: Rules<Move>, answers?: string[]) => (answers ? deciding(answers, () => replaced(g, dying, rules, { by: 'alice', about })) : replaced(g, dying, rules, { by: 'alice', about }));

  it('nothing applies: the happening as it was', () => {
    expect(run({ a: rule('a', 'hand', 'exile') })).toBe(dying);
  });

  it('CR 614.5: an effect applies to a happening once, though it would apply to what it made of it', () => {
    let times = 0;
    const again: Rules<Move> = { a: (_g, h) => [{ key: 'a', label: 'a', apply: (m) => (times++, { ...m, to: h.to }) }] };
    expect(run(again)?.to).toBe('graveyard');
    expect(times).toBe(1);
  });

  it('CR 616.1f: after each, the happening is looked at afresh — an effect on what it became applies, one on what it was no longer does', () => {
    const rules = { exile: rule('exile', 'graveyard', 'exile'), fromExile: rule('fromExile', 'exile', 'hand'), late: rule('late', 'graveyard', 'library') };
    expect(run(rules)?.to).toBe('hand');
  });

  it('nothing happens instead: null', () => {
    expect(run({ a: () => [{ key: 'a', label: 'a', apply: () => null }] })).toBeNull();
  });

  it('several that come to the same thing in any order: nobody is asked', () => {
    const rules = { a: rule('a', 'graveyard', 'exile'), b: rule('b', 'graveyard', 'exile') };
    expect(run(rules, [])?.to).toBe('exile');
  });

  it('CR 616.1: several that do not — the affected player is asked, and gets what they chose', () => {
    const rules = { a: rule('a', 'graveyard', 'exile'), b: rule('b', 'graveyard', 'exile', 'token'), c: rule('c', 'graveyard', 'library') };
    let asked: OrderNeeded | undefined;
    try {
      run(rules, []);
    } catch (err) {
      asked = err as OrderNeeded;
    }
    expect(asked).toBeInstanceOf(OrderNeeded);
    expect(asked!.player).toBe('alice');
    expect(asked!.options.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect(run(rules, ['a'])).toMatchObject({ to: 'exile', also: [] });
    expect(marks(run(rules, ['b']))).toEqual(['token']);
    expect(run(rules, ['c'])?.to).toBe('library');
  });

  it('a second question after the first is answered', () => {
    // a and b both apply, and whichever goes first, c and d apply to what it made.
    const rules = { a: rule('a', 'graveyard', 'exile', 'A'), b: rule('b', 'graveyard', 'exile', 'B'), c: rule('c', 'exile', 'hand', 'C'), d: rule('d', 'exile', 'library', 'D') };
    expect(() => run(rules, [])).toThrow(OrderNeeded);
    expect(() => run(rules, ['b'])).toThrow(OrderNeeded);
    expect(run(rules, ['b', 'd'])).toMatchObject({ to: 'library' });
    expect(marks(run(rules, ['b', 'd']))).toEqual(['B', 'D']);
  });

  it('while the engine only looks ahead, nobody is asked: the first takes it', () => {
    const rules = { a: rule('a', 'graveyard', 'exile'), b: rule('b', 'graveyard', 'library') };
    expect(run(rules)?.to).toBe('exile');
    expect(deciding([], () => lookingAhead(() => replaced(g, dying, rules, { by: 'alice', about })))?.to).toBe('exile');
  });

  it('CR 616.1a–d: a self-replacement effect goes first, then one about control, then one about copying — without asking', () => {
    const rules = { other: rule('other', 'graveyard', 'library'), copy: rule('copy', 'graveyard', 'hand', undefined, 'copy'), self: rule('self', 'graveyard', 'exile', undefined, 'self') };
    expect(run(rules, [])?.to).toBe('exile');
    const { self: _self, ...rest } = rules;
    expect(run(rest, [])?.to).toBe('hand');
  });

  it('the same effects to choose between again in the same action: as chosen before', () => {
    const rules = { a: rule('a', 'graveyard', 'exile'), b: rule('b', 'graveyard', 'library') };
    const both = deciding(['b'], () => [replaced(g, dying, rules, { by: 'alice', about }), replaced(g, { ...dying }, rules, { by: 'alice', about })]);
    expect(both.map((m) => m?.to)).toEqual(['library', 'library']);
  });

  it('an answer that fits no option now (the game went on in between) is dropped, and the question asked again', () => {
    const rules = { a: rule('a', 'graveyard', 'exile'), b: rule('b', 'graveyard', 'library') };
    const answers = ['gone', 'b'];
    expect(() => deciding(answers, () => replaced(g, dying, rules, { by: 'alice', about }))).toThrow(OrderNeeded);
    expect(answers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rules for a card changing zones, with the cards they come from
// ---------------------------------------------------------------------------

const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const EXTRA = [
  card('Rest in Peace', 'Enchantment', 'If a card or token would be put into a graveyard from anywhere, exile it instead.'),
  card('Leyline of the Void', 'Enchantment', "If a card would be put into an opponent's graveyard from anywhere, exile it instead."),
  card('Kalitas', 'Legendary Creature — Vampire Warrior', 'If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.', { power: '3', toughness: '4' }),
  card('Dauthi Voidwalker', 'Creature — Dauthi Rogue', "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.", { power: '3', toughness: '2' }),
  card('Containment Priest', 'Creature — Human Cleric', "If a nontoken creature would enter and it wasn't cast, exile it instead.", { power: '2', toughness: '2' }),
  card('Progenitus', 'Legendary Creature — Hydra Avatar', 'If Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner\'s library instead.', { power: '10', toughness: '10' }),
  card('Doom', 'Instant', 'Destroy target creature.'),
  card('Wrath', 'Sorcery', 'Destroy all creatures.'),
  card('Plague Wind', 'Sorcery', "Destroy all creatures you don't control."),
  card('Inferno', 'Sorcery', 'Inferno deals 6 damage to each creature.'),
  card('Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.'),
  card('Think Twice', 'Instant', 'Draw a card.\nFlashback {0}'),
  card('Fiery Temper', 'Instant', 'Fiery Temper deals 3 damage to any target.\nMadness {R}', { mana_cost: '{1}{R}{R}' }),
  card('Mind Rot', 'Sorcery', 'Target player discards a card.'),
  card('Dregscape Zombie', 'Creature — Zombie', 'Unearth {0}', { power: '2', toughness: '1' }),
  card('Altar', 'Artifact', 'Sacrifice a creature: You gain 1 life.'),
];

const cast = (g: GameState, player: PlayerId, name: string, target?: string | PlayerId): GameState => {
  const id = give(g, player, name, 'hand');
  const targets = target === undefined ? undefined : [[g.players[target] ? { kind: 'player' as const, player: target } : { kind: 'object' as const, object: target }]];
  return act(g, { type: 'cast', player, object: id, autoTap: true, ...(targets ? { targets } : {}) });
};
const order = (g: GameState): Extract<PendingChoice, { kind: 'choose_option' }> => {
  const p = g.pending;
  if (p?.kind !== 'choose_option' || !p.resume) throw new Error(`no question about replacement effects (pending: ${p?.kind ?? 'none'})`);
  return p;
};
const answer = (g: GameState, pick: string | RegExp): GameState => {
  const p = order(g);
  const choice = p.options.find((o) => (typeof pick === 'string' ? o.startsWith(pick) : pick.test(o)));
  if (!choice) throw new Error(`no option ${String(pick)} among ${p.options.join(' | ')}`);
  return act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_option', choice } });
};
const zoneOf = (g: GameState, id: string) => g.objects[id]!.zone;
const tokens = (g: GameState, player: PlayerId) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === player).length;
const game = () => toStep(start({ extra: EXTRA }), 'main1');

describe('a card changing zones', () => {
  it('one effect: it applies, and nobody is asked', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(g.pending).toBeNull();
    expect(zoneOf(g, bear)).toBe('exile');
  });

  it('two that come to the same thing (Rest in Peace, Leyline of the Void): nobody is asked', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Leyline of the Void', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(g.pending).toBeNull();
    expect(zoneOf(g, bear)).toBe('exile');
  });

  it("CR 616.1: Kalitas and Rest in Peace — the dying creature's controller chooses, and Kalitas gets its Zombie or doesn't", () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'alice', 'Doom', bear);
    const before = g;
    g = passRound(g);
    // The game as it was before the spell resolved, with the question for Bob.
    const p = order(g);
    expect(p.player).toBe('bob');
    expect(p.text).toMatch(/Grizzly Bears would die/);
    expect(p.options).toHaveLength(2);
    expect(p.options[0]).toMatch(/^Rest in Peace: If a card or token would be put into a graveyard/);
    expect(p.options[1]).toMatch(/^Kalitas: If a nontoken creature an opponent controls would die/);
    expect(g.stack).toHaveLength(before.stack.length);
    expect(zoneOf(g, bear)).toBe('battlefield');

    const plain = answer(g, 'Rest in Peace');
    expect(plain.pending).toBeNull();
    expect(zoneOf(plain, bear)).toBe('exile');
    expect(tokens(plain, 'alice')).toBe(0);
    expect(plain.stack).toHaveLength(0);

    const zombie = answer(g, 'Kalitas');
    expect(zoneOf(zombie, bear)).toBe('exile');
    expect(tokens(zombie, 'alice')).toBe(1);
  });

  it('only the player asked answers, and with one of the options', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    const p = order(g);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: p.options[0]! } })).toMatch(/no choice to make/);
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: 'Neither' } })).toMatch(/not one of the options/);
    expect(illegal(g, { type: 'pass', player: 'alice' })).toMatch(/Waiting for Bob/);
    // What the engine keeps to carry on with isn't part of what the player is shown.
    const seen = viewFor(g, 'bob').pending;
    expect(seen).toMatchObject({ kind: 'choose_option', options: p.options });
    expect(seen && 'resume' in seen).toBe(false);
  });

  it('foresee(): what an action would come to, for a preview — nothing is asked, the first effect takes it', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = act(cast(g, 'alice', 'Doom', bear), { type: 'pass', player: 'alice' });
    const seen = foresee(g, { type: 'pass', player: 'bob' });
    if (!seen.ok) throw new Error(seen.error);
    expect(seen.state.pending).toBeNull();
    expect(seen.state.objects[bear]!.zone).toBe('exile');
    expect(seen.events.some((e) => e.type === 'moved' && e.object === bear)).toBe(true);
    // Done for real, the same action asks.
    order(act(g, { type: 'pass', player: 'bob' }));
    // And an action that is refused is refused there too.
    expect(foresee(g, { type: 'pass', player: 'alice' })).toMatchObject({ ok: false });
  });

  it('several creatures at once: one question for each player whose creatures die, not one for each creature', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bears = [give(g, 'bob', 'Grizzly Bears', 'battlefield'), give(g, 'bob', 'Grizzly Bears', 'battlefield'), give(g, 'bob', 'Grizzly Bears', 'battlefield')];
    g = passRound(cast(g, 'alice', 'Plague Wind'));
    expect(order(g).player).toBe('bob');
    g = answer(g, 'Kalitas');
    expect(g.pending).toBeNull();
    expect(bears.map((id) => zoneOf(g, id))).toEqual(['exile', 'exile', 'exile']);
    expect(tokens(g, 'alice')).toBe(3);
  });

  it('CR 608.2c: permanents destroyed at once leave at once — an effect whose permanent goes with them applies to them all', () => {
    let g = game();
    const kalitas = give(g, 'alice', 'Kalitas', 'battlefield');
    const bears = [give(g, 'bob', 'Grizzly Bears', 'battlefield'), give(g, 'bob', 'Grizzly Bears', 'battlefield')];
    g = passRound(cast(g, 'alice', 'Wrath'));
    expect(g.pending).toBeNull();
    expect(zoneOf(g, kalitas)).toBe('graveyard');
    expect(bears.map((id) => zoneOf(g, id))).toEqual(['exile', 'exile']);
    expect(tokens(g, 'alice')).toBe(2);
  });

  it('CR 704.3: so do creatures that die of their damage together', () => {
    let g = game();
    const kalitas = give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Inferno'));
    expect(zoneOf(g, kalitas)).toBe('graveyard');
    expect(zoneOf(g, bear)).toBe('exile');
    expect(tokens(g, 'alice')).toBe(1);
  });

  it('Leyline of the Void and Dauthi Voidwalker: the owner chooses whether the card gets a void counter', () => {
    let g = game();
    give(g, 'alice', 'Leyline of the Void', 'battlefield');
    give(g, 'alice', 'Dauthi Voidwalker', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(order(g).player).toBe('bob');
    const without = answer(g, 'Leyline');
    expect(without.objects[bear]!.counters).toEqual({});
    const withIt = answer(g, 'Dauthi');
    expect(withIt.objects[bear]!.counters).toEqual({ void: 1 });
  });

  it("its own \"shuffle it into its owner's library instead\" and Rest in Peace: its owner chooses", () => {
    let g = game();
    give(g, 'bob', 'Rest in Peace', 'battlefield');
    const hydra = give(g, 'alice', 'Progenitus', 'battlefield');
    g = passRound(cast(g, 'alice', 'Wrath'));
    const p = order(g);
    expect(p.player).toBe('alice');
    expect(zoneOf(answer(g, 'Rest in Peace'), hydra)).toBe('exile');
    const shuffled = actWithEvents(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: p.options.find((o) => o.startsWith('Progenitus'))! } });
    expect(zoneOf(shuffled.state, hydra)).toBe('library');
    expect(shuffled.events.filter((e: GameEvent) => e.type === 'revealed' || e.type === 'shuffled').map((e) => e.type)).toEqual(['revealed', 'shuffled']);
  });

  it('CR 702.34a: a flashback spell with Rest in Peace out is exiled either way — nobody is asked', () => {
    let g = game();
    give(g, 'bob', 'Rest in Peace', 'battlefield');
    const spell = give(g, 'alice', 'Think Twice', 'graveyard');
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true });
    g = passRound(g);
    expect(g.pending).toBeNull();
    expect(zoneOf(g, spell)).toBe('exile');
  });

  it('CR 702.35a: madness replaces the discard; with Rest in Peace out the player chooses which exiles the card', () => {
    let g = game();
    const temper = give(g, 'bob', 'Fiery Temper', 'hand');
    g.zones.hand.bob = [temper];
    const alone = actWithEvents(cast(g, 'alice', 'Mind Rot', 'bob'), { type: 'pass', player: 'alice' });
    let h = actWithEvents(alone.state, { type: 'pass', player: 'bob' });
    while (h.state.pending?.kind === 'discard') h = actWithEvents(h.state, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: [temper] } });
    expect(zoneOf(h.state, temper)).toBe('exile');
    expect(h.events.find((e) => e.type === 'discarded')).toMatchObject({ madness: true });

    let r = game();
    give(r, 'alice', 'Rest in Peace', 'battlefield');
    const second = give(r, 'bob', 'Fiery Temper', 'hand');
    r.zones.hand.bob = [second];
    r = passRound(cast(r, 'alice', 'Mind Rot', 'bob'));
    if (r.pending?.kind === 'discard') r = act(r, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: [second] } });
    const p = order(r);
    expect(p.player).toBe('bob');
    expect(p.text).toMatch(/Fiery Temper would be discarded/);
    const viaMadness = actWithEvents(r, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: p.options.find((o) => /madness/.test(o))! } });
    expect(viaMadness.events.find((e) => e.type === 'discarded')).toMatchObject({ madness: true });
    const viaPeace = actWithEvents(r, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: p.options.find((o) => o.startsWith('Rest in Peace'))! } });
    expect(zoneOf(viaPeace.state, second)).toBe('exile');
    expect(viaPeace.events.find((e) => e.type === 'discarded')).not.toHaveProperty('madness');
  });

  it("Containment Priest: a creature put onto the battlefield without being cast is exiled; one that is cast isn't", () => {
    let g = game();
    give(g, 'bob', 'Containment Priest', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    g = passRound(cast(g, 'alice', 'Raise', bear));
    expect(zoneOf(g, bear)).toBe('exile');
    const second = give(g, 'alice', 'Grizzly Bears', 'hand');
    g.players.alice!.pool.G = 2;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: second }));
    expect(zoneOf(g, second)).toBe('battlefield');
  });

  it("CR 702.84a: an unearthed creature that would die with Kalitas out — its controller chooses which exiles it", () => {
    let g = game();
    give(g, 'bob', 'Kalitas', 'battlefield');
    const zombie = give(g, 'alice', 'Dregscape Zombie', 'graveyard');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: zombie, ability: 0, autoTap: true }));
    expect(zoneOf(g, zombie)).toBe('battlefield');
    g = passRound(cast(g, 'alice', 'Doom', zombie));
    expect(order(g).player).toBe('alice');
    const quiet = answer(g, /^The effect that put it there/);
    expect(zoneOf(quiet, zombie)).toBe('exile');
    expect(tokens(quiet, 'bob')).toBe(0);
    expect(tokens(answer(g, 'Kalitas'), 'bob')).toBe(1);
  });

  it('a question that comes up while another choice is being answered: both are carried through', () => {
    let g = game();
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const altar = give(g, 'bob', 'Altar', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    // Bob sacrifices the Bear as a cost: the action itself comes to the question.
    g = act(g, { type: 'activate', player: 'bob', object: altar, ability: 0, autoTap: true, costs: { sacrifice: [bear] } });
    expect(order(g).player).toBe('bob');
    expect(zoneOf(g, bear)).toBe('battlefield');
    expect(g.stack).toHaveLength(0);
    g = answer(g, 'Rest in Peace');
    expect(zoneOf(g, bear)).toBe('exile');
    expect(g.stack).toHaveLength(1);
    expect(tokens(g, 'alice')).toBe(0);
  });

  it('a player leaves the game while the question is open: it stays open, and the answer carries on from the game as it is then', () => {
    let g = toStep(start({ extra: EXTRA, players: 4 }), 'main1');
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    order(g);
    g = act(g, { type: 'concede', player: 'carol' });
    expect(order(g).player).toBe('bob');
    g = answer(g, 'Kalitas');
    expect(zoneOf(g, bear)).toBe('exile');
    expect(tokens(g, 'alice')).toBe(1);
    expect(g.players.carol!.lost).toBe(true);
  });

  it('the action that came to the question was that of a player who has left since: the question is void, and comes again when it must', () => {
    let g = toStep(start({ extra: EXTRA, players: 3 }), 'main1');
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    // Carol is the last to pass: her pass is what resolves the spell.
    g = passRound(cast(g, 'alice', 'Doom', bear));
    order(g);
    g = act(g, { type: 'concede', player: 'carol' });
    g = answer(g, 'Kalitas');
    expect(g.pending).toBeNull();
    expect(zoneOf(g, bear)).toBe('battlefield');
    expect(g.stack).toHaveLength(1);
    g = passRound(g);
    expect(order(g).player).toBe('bob');
    g = answer(g, 'Rest in Peace');
    expect(zoneOf(g, bear)).toBe('exile');
    expect(tokens(g, 'alice')).toBe(0);
  });

  it('the player asked leaves the game: nothing is left to ask', () => {
    let g = toStep(start({ extra: EXTRA, players: 3 }), 'main1');
    give(g, 'alice', 'Rest in Peace', 'battlefield');
    give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Doom', bear));
    order(g);
    g = act(g, { type: 'concede', player: 'bob' });
    expect(g.pending).toBeNull();
    expect(g.objects[bear]).toBeUndefined();
  });

  it('every sort of replacement of a move is a rule in the table, and the mover names none of them', async () => {
    expect(Object.keys(MOVE_RULES)).toEqual(['madness', 'enters_uncast', 'leaves_the_stack', 'leaves_the_battlefield', 'dies_this_turn', 'creatures_die_this_turn', 'own_exile', 'exile_instead', 'own_shuffle']);
    const { readFileSync } = await import('node:fs');
    const mover = readFileSync(new URL('../src/zones.ts', import.meta.url), 'utf8');
    const body = mover
      .slice(mover.indexOf('export function moveObject('), mover.indexOf('function hostsForEnteringAura('))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const word of ['exile_instead', 'exileOnLeave ===', 'exileWhenLeaves)', 'exileIfDiesTurn ===', 'exileDyingTurn', 'graveyard_to_', 'enter_exile_uncast', 'madness']) expect(body, word).not.toContain(word);
  });
});

// ---------------------------------------------------------------------------
// How a permanent enters (CR 614.12): the same path, the rules of instead-enters.ts
// ---------------------------------------------------------------------------

describe('a permanent entering', () => {
  const ENTERS = [
    card('Mimic', 'Artifact Creature — Shapeshifter', 'As this creature enters, choose a creature type.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.', { power: '2', toughness: '1' }),
    card('Scales', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.'),
    card('Season', 'Enchantment', 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.'),
    card('Hatchling', 'Creature — Elf', 'This creature enters with a +1/+1 counter on it.', { power: '1', toughness: '1' }),
    card('Guildgate', 'Land — Gate', 'This land enters tapped.\n{T}: Add {G}.'),
    card('Spelunking', 'Enchantment', 'Lands you control enter untapped.'),
    card('Frozen Aether', 'Enchantment', 'Artifacts, creatures, and lands your opponents control enter tapped.'),
    card('Plains Elf', 'Creature — Elf', '', { power: '1', toughness: '1' }),
  ];
  const board = () => toStep(start({ extra: ENTERS }), 'main1');
  const play = (g: GameState, player: PlayerId, name: string): [GameState, string] => {
    const id = give(g, player, name, 'hand');
    const land = g.cards[name]!.faces[0]!.types.includes('Land');
    let h = land ? act(g, { type: 'play_land', player, object: id }) : passRound(act(g, { type: 'cast', player, object: id, autoTap: true }));
    while (h.pending?.kind === 'as_enters') h = act(h, { type: 'choose', player: h.pending.player, answer: { kind: 'as_enters', choice: 'Elf' } });
    return [h, id];
  };

  it('CR 122.6: counters it enters with from several effects are put on it at once — "that many plus one" adds one', () => {
    let g = board();
    [g] = play(g, 'alice', 'Mimic');
    give(g, 'alice', 'Scales', 'battlefield');
    let elf: string;
    // Its own counter and the Mimic's: two, and one more for the lot. (Not one more for each of the two.)
    [g, elf] = play(g, 'alice', 'Hatchling');
    expect(g.objects[elf]!.counters['+1/+1']).toBe(3);
    // Doubled as a lot too: (2 + 1) × 2, the order that gives the most.
    give(g, 'alice', 'Season', 'battlefield');
    [g, elf] = play(g, 'alice', 'Hatchling');
    expect(g.objects[elf]!.counters['+1/+1']).toBe(6);
  });

  it('CR 616.1: "enters tapped" and "Lands you control enter untapped" — its controller orders them, so it enters untapped', () => {
    let g = board();
    let gate: string;
    [g, gate] = play(g, 'alice', 'Guildgate');
    expect(g.objects[gate]!.tapped).toBe(true);

    let h = board();
    give(h, 'alice', 'Spelunking', 'battlefield');
    give(h, 'bob', 'Frozen Aether', 'battlefield');
    [h, gate] = play(h, 'alice', 'Guildgate');
    expect(h.objects[gate]!.tapped).toBe(false);
    // Somebody else's Spelunking is no help.
    let k = board();
    give(k, 'bob', 'Spelunking', 'battlefield');
    [k, gate] = play(k, 'alice', 'Guildgate');
    expect(k.objects[gate]!.tapped).toBe(true);
  });

  it("CR 614.1d: another permanent's \"enter tapped\" applies to what it says, and to nothing else", () => {
    let g = board();
    give(g, 'bob', 'Frozen Aether', 'battlefield');
    let elf: string;
    [g, elf] = play(g, 'alice', 'Plains Elf');
    expect(g.objects[elf]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    [g, elf] = play(g, 'bob', 'Plains Elf');
    expect(g.objects[elf]!.tapped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A player drawing a card: the same path, the rules of instead-draws.ts
// ---------------------------------------------------------------------------

describe('a player drawing', () => {
  const DRAWS = [
    card('Notion Thief', 'Enchantment', 'If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.'),
    card('Thought Reflection', 'Enchantment', 'If you would draw a card, draw two cards instead.'),
    card('Archive', 'Artifact', 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.'),
    card('Laboratory Maniac', 'Enchantment', 'If you would draw a card while your library has no cards in it, you win the game instead.'),
    card('Divination', 'Sorcery', 'Draw two cards.'),
    card('Opt', 'Instant', 'Draw a card.'),
  ];
  const board = () => toStep(start({ extra: DRAWS, players: 3 }), 'main1');
  const hand = (g: GameState, p: PlayerId) => g.zones.hand[p]!.length;

  it('one effect: two cards instead of one; with two such effects, four', () => {
    let g = board();
    give(g, 'alice', 'Thought Reflection', 'battlefield');
    const before = hand(g, 'alice');
    g = passRound(cast(g, 'alice', 'Opt'));
    expect(hand(g, 'alice')).toBe(before + 2);
    give(g, 'alice', 'Thought Reflection', 'battlefield');
    g = passRound(cast(g, 'alice', 'Opt'));
    expect(hand(g, 'alice')).toBe(before + 6);
  });

  it("CR 614.5: two players' Notion Thieves each replace a draw once — the draw comes back to the one who stole it first, and is drawn", () => {
    // (Each took the draw from the other without end before: the engine never came back.)
    let g = board();
    give(g, 'bob', 'Notion Thief', 'battlefield');
    give(g, 'carol', 'Notion Thief', 'battlefield');
    const before = { alice: hand(g, 'alice'), bob: hand(g, 'bob'), carol: hand(g, 'carol') };
    g = passRound(cast(g, 'alice', 'Opt'));
    // Alice's draw is Bob's instead; Bob's is Carol's instead; Carol's is Bob's again — who has had his turn at it.
    expect(hand(g, 'alice')).toBe(before.alice);
    expect(hand(g, 'bob') + hand(g, 'carol')).toBe(before.bob + before.carol + 1);
  });

  it("the first card of a draw step, drawn twice over: the first of the two is still the first — the Thief takes the other", () => {
    let g = toStep(start({ extra: DRAWS, players: 2 }), 'main1');
    give(g, 'bob', 'Thought Reflection', 'battlefield');
    give(g, 'alice', 'Notion Thief', 'battlefield');
    const before = { alice: hand(g, 'alice'), bob: hand(g, 'bob') };
    g = toStep(g, 'main1', 'bob');
    expect(hand(g, 'bob')).toBe(before.bob + 1);
    expect(hand(g, 'alice')).toBe(before.alice + 1);
  });

  it('"except the first one you draw in each of your draw steps": the draw step\'s card is one, a spell\'s card is two', () => {
    let g = toStep(start({ extra: DRAWS, players: 2 }), 'main1');
    give(g, 'bob', 'Archive', 'battlefield');
    const before = hand(g, 'bob');
    g = toStep(g, 'main1', 'bob');
    expect(hand(g, 'bob')).toBe(before + 1);
    g = passRound(cast(g, 'bob', 'Opt'));
    expect(hand(g, 'bob')).toBe(before + 3);
  });

  it('CR 616.1: an empty library, a draw that would be doubled, and Laboratory Maniac — the player takes the win', () => {
    let g = board();
    give(g, 'alice', 'Thought Reflection', 'battlefield');
    give(g, 'alice', 'Laboratory Maniac', 'battlefield');
    g.zones.library.alice = [];
    g = passRound(cast(g, 'alice', 'Opt'));
    expect(g.winner).toBe('alice');
  });

  it('a library that runs out halfway through two cards: the second is the win', () => {
    let g = board();
    give(g, 'alice', 'Laboratory Maniac', 'battlefield');
    g.zones.library.alice = g.zones.library.alice!.slice(0, 1);
    g = passRound(cast(g, 'alice', 'Divination'));
    expect(g.winner).toBe('alice');
  });
});

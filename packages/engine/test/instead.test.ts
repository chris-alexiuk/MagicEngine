import { describe, expect, it } from 'vitest';
import { OrderNeeded, deciding, lookingAhead, replaced, type Move, type Replacement, type Rules } from '../src/instead.js';
import { DAMAGE_RULES } from '../src/instead-damage.js';
import { DESTROY_RULES } from '../src/instead-destroy.js';
import { MOVE_RULES } from '../src/instead-moves.js';
import { TOKEN_RULES } from '../src/instead-tokens.js';
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
    expect(Object.keys(MOVE_RULES)).toEqual(['madness', 'enters_uncast', 'leaves_the_stack', 'leaves_the_battlefield', 'dies_this_turn', 'creatures_die_this_turn', 'own_exile', 'exile_instead', 'own_shuffle', 'commander']);
    const { readFileSync } = await import('node:fs');
    const mover = readFileSync(new URL('../src/zones.ts', import.meta.url), 'utf8');
    const body = mover
      .slice(mover.indexOf('export function moveObject('), mover.indexOf('function hostsForEnteringAura('))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const word of ['exile_instead', 'exileOnLeave ===', 'exileWhenLeaves)', 'exileIfDiesTurn ===', 'exileDyingTurn', 'graveyard_to_', 'enter_exile_uncast', 'madness', "to === 'hand'"]) expect(body, word).not.toContain(word);
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

// ---------------------------------------------------------------------------
// Damage about to be dealt: the same path, the rules of instead-damage.ts
// ---------------------------------------------------------------------------

describe('damage about to be dealt', () => {
  const DAMAGE = [
    card('Bolt', 'Instant', 'Bolt deals 2 damage to any target.'),
    card('Big Bolt', 'Instant', 'Big Bolt deals 5 damage to any target.'),
    card('Furnace', 'Enchantment', 'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.'),
    card('Salve', 'Instant', 'Prevent the next 3 damage that would be dealt to any target this turn.'),
    card('Giant', 'Creature — Giant', 'If a source would deal 3 or less damage to this creature, prevent that damage.', { power: '4', toughness: '4' }),
    card('Warded Bear', 'Creature — Bear', 'Protection from red', { power: '2', toughness: '2' }),
    card('Shield Up', 'Instant', 'Put a shield counter on target creature.'),
    card('Unstoppable', 'Instant', "Unstoppable deals 2 damage to target creature. The damage can't be prevented."),
    card('Pariah', 'Enchantment — Aura', 'Enchant creature\nAll damage that would be dealt to you is dealt to enchanted creature instead.'),
    card('Vigor', 'Enchantment', 'If damage would be dealt to a creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way.'),
    card('Wall', 'Creature — Wall', 'Defender', { power: '0', toughness: '7' }),
    card('Rain', 'Sorcery', 'Rain deals 2 damage to each creature.'),
  ];
  const board = () => toStep(start({ extra: DAMAGE }), 'main1');
  const red = (g: GameState, name: string) => {
    g.cards[name] = { ...g.cards[name]!, faces: [{ ...g.cards[name]!.faces[0]!, colors: ['R'] }] };
  };
  const prevented = (events: GameEvent[]) => events.filter((e) => e.type === 'prevented').map((e) => (e as { amount: number }).amount);

  it('CR 616.1: damage that would be doubled and has a "prevent the next 3" on it — prevented first, then doubled', () => {
    let g = board();
    give(g, 'bob', 'Furnace', 'battlefield');
    g = passRound(cast(g, 'alice', 'Salve', 'alice'));
    // 2 damage: all of it prevented, and twice nothing is nothing. (Doubled first, 1 of the 4 would get through.)
    g = passRound(cast(g, 'alice', 'Bolt', 'alice'));
    expect(g.players.alice!.life).toBe(20);
    // The shield still has 1 to give: 5 damage, 1 prevented, 4 doubled.
    expect(g.prevention).toMatchObject([{ amount: 1 }]);
    g = passRound(cast(g, 'alice', 'Big Bolt', 'alice'));
    expect(g.players.alice!.life).toBe(12);
    expect(g.prevention).toEqual([]);
  });

  it('"3 or less damage" that would be doubled past 3: prevented while it is 2', () => {
    let g = board();
    give(g, 'bob', 'Furnace', 'battlefield');
    const giant = give(g, 'alice', 'Giant', 'battlefield');
    g = passRound(cast(g, 'alice', 'Bolt', giant));
    expect(g.objects[giant]!.damage).toBe(0);
    // 5 is more than 3 either way: doubled, and dealt.
    g = passRound(cast(g, 'alice', 'Big Bolt', giant));
    expect(g.objects[giant]?.zone).toBe('graveyard');
  });

  it('protection from the source, and a shield counter or a "prevent the next 3": the protection takes it, and nothing is used up', () => {
    let g = board();
    red(g, 'Rain');
    const bear = give(g, 'alice', 'Warded Bear', 'battlefield');
    const wall = give(g, 'alice', 'Wall', 'battlefield');
    g = passRound(cast(g, 'alice', 'Shield Up', bear));
    g = passRound(cast(g, 'alice', 'Salve', bear));
    const r = actWithEvents(act(cast(g, 'alice', 'Rain'), { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    // The Wall, with no protection, is dealt it; the Bear isn't, and has all it had.
    expect(r.state.objects[wall]!.damage).toBe(2);
    expect(r.state.objects[bear]!.damage).toBe(0);
    expect(r.state.objects[bear]!.counters.shield).toBe(1);
    expect(r.state.prevention).toMatchObject([{ amount: 3 }]);
  });

  it("CR 122.1c: a shield counter is removed instead even of damage that can't be prevented; protection doesn't stop that damage", () => {
    let g = board();
    const wall = give(g, 'alice', 'Wall', 'battlefield');
    g = passRound(cast(g, 'alice', 'Shield Up', wall));
    g = passRound(cast(g, 'alice', 'Salve', wall));
    g = passRound(cast(g, 'alice', 'Unstoppable', wall));
    // Not prevented (the "next 3" is untouched): the shield counter went instead.
    expect(g.objects[wall]!.damage).toBe(0);
    expect(g.objects[wall]!.counters.shield).toBeUndefined();
    expect(g.prevention).toMatchObject([{ amount: 3 }]);
    g = passRound(cast(g, 'alice', 'Unstoppable', wall));
    expect(g.objects[wall]!.damage).toBe(2);
  });

  it('a shield counter is kept where plain prevention does the same: "prevent the next 3" first', () => {
    let g = board();
    const wall = give(g, 'alice', 'Wall', 'battlefield');
    g = passRound(cast(g, 'alice', 'Shield Up', wall));
    g = passRound(cast(g, 'alice', 'Salve', wall));
    g = passRound(cast(g, 'alice', 'Bolt', wall));
    // Either leaves no damage; the shield counter is the one that couldn't be had back. (Nothing prevents all of 5:
    // then it goes — the least damage first.)
    expect(g.objects[wall]!.counters.shield).toBe(1);
    expect(g.prevention).toMatchObject([{ amount: 1 }]);
    g = passRound(cast(g, 'alice', 'Big Bolt', wall));
    expect(g.objects[wall]!.damage).toBe(0);
    expect(g.objects[wall]!.counters.shield).toBeUndefined();
  });

  it('CR 614.1b, 615.5: damage sent on to a creature, prevented there, with what the prevention does besides', () => {
    let g = board();
    const wall = give(g, 'alice', 'Wall', 'battlefield');
    const pariah = give(g, 'alice', 'Pariah', 'battlefield');
    g.objects[pariah]!.attachedTo = { id: wall, zcc: g.objects[wall]!.zcc };
    const r = actWithEvents(act(cast(toStep(g, 'main1', 'bob'), 'bob', 'Bolt', 'alice'), { type: 'pass', player: 'bob' }), { type: 'pass', player: 'alice' });
    expect(r.state.players.alice!.life).toBe(20);
    expect(r.state.objects[wall]!.damage).toBe(2);

    let v = board();
    const wall2 = give(v, 'alice', 'Wall', 'battlefield');
    const aura = give(v, 'alice', 'Pariah', 'battlefield');
    v.objects[aura]!.attachedTo = { id: wall2, zcc: v.objects[wall2]!.zcc };
    give(v, 'alice', 'Vigor', 'battlefield');
    const s = actWithEvents(act(cast(toStep(v, 'main1', 'bob'), 'bob', 'Bolt', 'alice'), { type: 'pass', player: 'bob' }), { type: 'pass', player: 'alice' });
    expect(s.state.players.alice!.life).toBe(20);
    expect(s.state.objects[wall2]!.damage).toBe(0);
    expect(s.state.objects[wall2]!.counters['+1/+1']).toBe(2);
    expect(prevented(s.events)).toEqual([2]);
  });

  it('every sort of replacement or prevention of damage is a rule in the table, and the dealer names none of them', async () => {
    expect(Object.keys(DAMAGE_RULES)).toEqual(['redirected', 'changed', 'prevented', 'shielded', 'protected', 'shield_counter']);
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
    const body = code
      .slice(code.indexOf('export function dealDamage('), code.indexOf('export function needsSecondDamageStep('))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(body.length).toBeGreaterThan(500);
    for (const word of ['prevent_damage', 'redirect_damage', 'g.prevention', 'rotectedFrom', 'removeShield', "replaceQuantity(g, 'damage'", 'shield']) expect(body, word).not.toContain(word);
  });
});

// ---------------------------------------------------------------------------
// A permanent about to be destroyed (CR 701.8): the same path, the rules of instead-destroy.ts
// ---------------------------------------------------------------------------

describe('a permanent about to be destroyed', () => {
  const DESTROY = [
    card('Shield Up', 'Instant', 'Put a shield counter on target creature.'),
    card('Troll', 'Creature — Troll', '{0}: Regenerate this creature.', { power: '2', toughness: '2' }),
    card('Hyena Umbra', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 and has first strike.\nUmbra armor'),
    card('Spider Umbra', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 and has reach.\nUmbra armor'),
    card('Doom', 'Instant', 'Destroy target creature.'),
    card('Final Doom', 'Instant', "Destroy target creature. It can't be regenerated."),
    card('Darksteel Bear', 'Creature — Bear', 'Indestructible', { power: '2', toughness: '2' }),
    card('Bolt', 'Instant', 'Bolt deals 3 damage to any target.'),
  ];
  const board = () => toStep(start({ extra: DESTROY }), 'main1');
  /** A Troll of Alice's with a regeneration shield. */
  const troll = (g: GameState): [GameState, string] => {
    const id = give(g, 'alice', 'Troll', 'battlefield');
    const next = passRound(act(g, { type: 'activate', player: 'alice', object: id, ability: 0 }));
    expect(next.objects[id]!.regenShields).toBe(1);
    return [next, id];
  };
  const enchant = (g: GameState, name: string, on: string): string => {
    const aura = give(g, 'alice', name, 'battlefield');
    g.objects[aura]!.attachedTo = { id: on, zcc: g.objects[on]!.zcc };
    return aura;
  };

  it('one effect: it applies, and nobody is asked', () => {
    let [g, id] = troll(board());
    g = passRound(cast(g, 'alice', 'Doom', id));
    expect(g.pending).toBeNull();
    expect(g.objects[id]).toMatchObject({ zone: 'battlefield', tapped: true, regenShields: 0 });
  });

  it('CR 616.1: a shield counter and a regeneration shield — its controller chooses which is used', () => {
    let [g, id] = troll(board());
    g = passRound(cast(g, 'alice', 'Shield Up', id));
    g = passRound(cast(g, 'alice', 'Doom', id));
    const p = order(g);
    expect(p.player).toBe('alice');
    expect(p.text).toBe('Troll would be destroyed, and more than one effect replaces that. Which applies?');
    expect(p.options).toEqual(['Its shield counter: remove it instead', 'Regeneration: remove all damage from it and tap it instead']);

    const counter = answer(g, 'Its shield counter');
    expect(counter.pending).toBeNull();
    expect(counter.objects[id]).toMatchObject({ zone: 'battlefield', tapped: false, regenShields: 1 });
    expect(counter.objects[id]!.counters.shield).toBeUndefined();

    const regenerated = answer(g, 'Regeneration');
    expect(regenerated.objects[id]).toMatchObject({ zone: 'battlefield', tapped: true, regenShields: 0 });
    expect(regenerated.objects[id]!.counters.shield).toBe(1);
  });

  it('CR 702.89a: two Umbras on it — its controller chooses which is destroyed', () => {
    let g = board();
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const hyena = enchant(g, 'Hyena Umbra', bear);
    const spider = enchant(g, 'Spider Umbra', bear);
    g.objects[bear]!.damage = 1;
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(order(g).options).toEqual(['Hyena Umbra: umbra armor — remove all damage from it and destroy this Aura instead', 'Spider Umbra: umbra armor — remove all damage from it and destroy this Aura instead']);
    g = answer(g, 'Spider Umbra');
    expect(g.pending).toBeNull();
    expect(g.objects[bear]).toMatchObject({ zone: 'battlefield', damage: 0 });
    expect([zoneOf(g, hyena), zoneOf(g, spider)]).toEqual(['battlefield', 'graveyard']);
  });

  it('CR 704.5g: destroyed for the damage on it — the same choice', () => {
    let [g, id] = troll(board());
    const umbra = enchant(g, 'Hyena Umbra', id);
    g = passRound(cast(g, 'alice', 'Bolt', id));
    expect(order(g).options).toHaveLength(2);
    const kept = answer(g, 'Regeneration');
    expect(kept.objects[id]).toMatchObject({ zone: 'battlefield', damage: 0, tapped: true });
    expect(zoneOf(kept, umbra)).toBe('battlefield');
    const lost = answer(g, 'Hyena Umbra');
    expect(lost.objects[id]).toMatchObject({ zone: 'battlefield', damage: 0, tapped: false, regenShields: 1 });
    expect(zoneOf(lost, umbra)).toBe('graveyard');
  });

  it("CR 701.19c: \"It can't be regenerated\" — the shield counter is all that applies, and nobody is asked", () => {
    let [g, id] = troll(board());
    g = passRound(cast(g, 'alice', 'Shield Up', id));
    g = passRound(cast(g, 'alice', 'Final Doom', id));
    expect(g.pending).toBeNull();
    expect(g.objects[id]).toMatchObject({ zone: 'battlefield', tapped: false, regenShields: 1 });
    expect(g.objects[id]!.counters.shield).toBeUndefined();
    // With nothing left to replace it, it is destroyed.
    g = passRound(cast(g, 'alice', 'Final Doom', id));
    expect(zoneOf(g, id)).toBe('graveyard');
  });

  it("CR 702.12b: a permanent that can't be destroyed isn't about to be — its shield counter stays", () => {
    let g = board();
    const bear = give(g, 'alice', 'Darksteel Bear', 'battlefield');
    g = passRound(cast(g, 'alice', 'Shield Up', bear));
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.counters.shield).toBe(1);
  });

  it('what is done instead is put to the rules in its turn: an Umbra with a shield counter loses that, and both stay', () => {
    let g = board();
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const umbra = enchant(g, 'Hyena Umbra', bear);
    g.objects[umbra]!.counters.shield = 1;
    g = passRound(cast(g, 'alice', 'Doom', bear));
    expect(g.pending).toBeNull();
    expect([zoneOf(g, bear), zoneOf(g, umbra)]).toEqual(['battlefield', 'battlefield']);
    expect(g.objects[umbra]!.counters.shield).toBeUndefined();
  });

  it('while the engine only looks ahead nobody is asked: the first takes it', () => {
    let [g, id] = troll(board());
    g = passRound(cast(g, 'alice', 'Shield Up', id));
    g = act(cast(g, 'alice', 'Doom', id), { type: 'pass', player: 'alice' });
    const seen = foresee(g, { type: 'pass', player: 'bob' });
    if (!seen.ok) throw new Error(seen.error);
    expect(seen.state.pending).toBeNull();
    expect(seen.state.objects[id]!.counters.shield).toBeUndefined();
    expect(seen.state.objects[id]!.regenShields).toBe(1);
  });

  it('every sort of replacement of a destruction is a rule in the table, and permanents.ts names none of them', async () => {
    expect(Object.keys(DESTROY_RULES)).toEqual(['shield_counter', 'regenerated', 'umbra_armor']);
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('../src/permanents.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const word of ['regenShields', 'umbra_armor', 'totem_armor', 'cant_be_regenerated']) expect(code, word).not.toContain(word);
  });
});

// ---------------------------------------------------------------------------
// Tokens about to be created (CR 111.1): the same path, the rules of instead-tokens.ts
// ---------------------------------------------------------------------------

describe('tokens about to be created', () => {
  const TOKENS = [
    card('Soldiers', 'Sorcery', 'Create a 1/1 white Soldier creature token.'),
    card('Tapped Soldiers', 'Sorcery', 'Create two tapped 1/1 white Soldier creature tokens.'),
    card('Riches', 'Sorcery', 'Create a Treasure token.'),
    card('Season', 'Enchantment', 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'),
    card('Took', 'Legendary Creature — Halfling', 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.', { power: '2', toughness: '3' }),
    card('Chatterfang', 'Legendary Creature — Squirrel', 'If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.', { power: '3', toughness: '3' }),
    card('Visitation', 'Enchantment', 'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.'),
    card('Manufactor', 'Artifact Creature — Assembly-Worker', 'If you would create a Clue, Food, or Treasure token, instead create one of each.', { power: '1', toughness: '3' }),
    card('Xorn', 'Creature — Elemental', 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.', { power: '3', toughness: '2' }),
  ];
  const board = (...permanents: string[]) => {
    const g = toStep(start({ extra: TOKENS }), 'main1');
    for (const name of permanents) give(g, 'alice', name, 'battlefield');
    return g;
  };
  /** Alice's tokens, by kind: "Soldier ×2, Food". */
  const made = (g: GameState): string => {
    const counts: Record<string, number> = {};
    for (const id of g.zones.battlefield) {
      const o = g.objects[id]!;
      if (!o.token || o.controller !== 'alice') continue;
      const name = g.cards[o.card]!.faces[0]!.name.replace(/ Token$/, '');
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
      .join(', ');
  };

  it('no effect: the tokens asked for; one effect: it applies, and nobody is asked', () => {
    expect(made(passRound(cast(board(), 'alice', 'Soldiers')))).toBe('Soldier');
    const g = passRound(cast(board('Season'), 'alice', 'Soldiers'));
    expect(g.pending).toBeNull();
    expect(made(g)).toBe('Soldier ×2');
  });

  it('CR 616.1: "plus an additional Food token" and "twice that many" — the Food first, unasked: it is doubled too', () => {
    const g = passRound(cast(board('Took', 'Season'), 'alice', 'Soldiers'));
    expect(g.pending).toBeNull();
    expect(made(g)).toBe('Food ×2, Soldier ×2');
  });

  it('CR 614.5: "plus that many Squirrels" and "twice that many" — each applies once, whichever goes first', () => {
    const g = passRound(cast(board('Chatterfang', 'Season'), 'alice', 'Soldiers'));
    expect(g.pending).toBeNull();
    // (Not four Squirrels: the doubling isn't done to the Soldier and then again to the Squirrels made for two Soldiers.)
    expect(made(g)).toBe('Soldier ×2, Squirrel ×2');
  });

  it('"plus an additional Food" and "plus that many Squirrels": the Food first — a Squirrel for it too', () => {
    const g = passRound(cast(board('Chatterfang', 'Took'), 'alice', 'Soldiers'));
    expect(g.pending).toBeNull();
    expect(made(g)).toBe('Food, Soldier, Squirrel ×2');
  });

  it('Academy Manufactor and Xorn: the additional Treasure first — two of each', () => {
    const g = passRound(cast(board('Manufactor', 'Xorn'), 'alice', 'Riches'));
    expect(g.pending).toBeNull();
    expect(made(g)).toBe('Clue ×2, Food ×2, Treasure ×2');
  });

  it('two Academy Manufactors: each applies once — three of each', () => {
    expect(made(passRound(cast(board('Manufactor', 'Manufactor'), 'alice', 'Riches')))).toBe('Clue ×3, Food ×3, Treasure ×3');
  });

  it('CR 616.1: Divine Visitation and Chatterfang — two Angels, or an Angel and a Squirrel: the player is asked', () => {
    const g = passRound(cast(board('Visitation', 'Chatterfang'), 'alice', 'Soldiers'));
    const p = order(g);
    expect(p.player).toBe('alice');
    expect(p.text).toBe('Alice would create tokens (1 Soldier Token), and more than one effect replaces that. Which applies first?');
    expect(p.options).toHaveLength(2);
    expect(made(g)).toBe('');
    expect(made(answer(g, 'Chatterfang'))).toBe('Angel ×2');
    expect(made(answer(g, 'Visitation'))).toBe('Angel, Squirrel');
    // Looking ahead, nobody is asked.
    const before = act(cast(board('Visitation', 'Chatterfang'), 'alice', 'Soldiers'), { type: 'pass', player: 'alice' });
    const seen = foresee(before, { type: 'pass', player: 'bob' });
    expect(seen.ok && seen.state.pending).toBeNull();
  });

  it('what an effect says of its tokens it says of those: the ones another effect adds are not tapped', () => {
    const g = passRound(cast(board('Took', 'Season'), 'alice', 'Tapped Soldiers'));
    const tapped = (name: string) => g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.token && g.cards[o.card]!.faces[0]!.name.startsWith(name)).map((o) => o.tapped);
    expect(tapped('Soldier')).toEqual([true, true, true, true]);
    expect(tapped('Food')).toEqual([false, false]);
  });

  it("another player's tokens are theirs: these effects say \"under your control\"", () => {
    let g = board('Took', 'Season', 'Visitation');
    g = toStep(g, 'main1', 'bob');
    g = passRound(cast(g, 'bob', 'Soldiers'));
    expect(made(g)).toBe('');
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'bob')).toHaveLength(1);
  });

  it('every sort of replacement of a creation is a rule in the table, and nothing that creates tokens names one', async () => {
    expect(Object.keys(TOKEN_RULES)).toEqual(['one_of_each', 'added', 'changed', 'swapped']);
    const { readFileSync } = await import('node:fs');
    const code = (file: string) =>
      readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    for (const word of ['replace_quantity', 'token_one_of_each', 'tokenFilter', "'swap'", "'extra'"]) expect(code('permanents.ts'), word).not.toContain(word);
    for (const word of ["'tokens'", 'tokenFilter', "a.effect.type === 'token_one_of_each'"]) expect(code('core-plugin.ts'), word).not.toContain(word);
  });
});

// ---------------------------------------------------------------------------
// CR 903.9b: a commander about to go to its owner's hand or library — an effect its owner may leave unapplied
// ---------------------------------------------------------------------------

describe("a commander about to be put into its owner's hand or library", () => {
  const COMMAND = [
    card('Captain', 'Legendary Creature — Human Soldier', '', { power: '3', toughness: '3' }),
    card('Hydra', 'Legendary Creature — Hydra', "If Hydra would be put into a graveyard from anywhere, reveal Hydra and shuffle it into its owner's library instead.", { power: '5', toughness: '5' }),
    card('Unsummon', 'Instant', "Return target creature to its owner's hand."),
    card('Tuck', 'Instant', "Put target creature on the bottom of its owner's library."),
    card('Lapse', 'Instant', "Put target creature on top of its owner's library."),
    card('Doom', 'Instant', 'Destroy target creature.'),
    card('Insight', 'Sorcery', 'Draw a card.'),
  ];
  const forests = Array.from({ length: 40 }, () => 'Forest');
  /** Alice's commander, cast and on the battlefield. */
  const game = (name = 'Captain'): [GameState, string] => {
    // (Bob's deck holds the spells, so that the game knows them.)
    const spells = COMMAND.map((c) => c.name).filter((n) => n !== 'Captain' && n !== 'Hydra');
    let g = toStep(start({ format: 'commander', extra: COMMAND, decks: { alice: [...forests.slice(1), name], bob: [...forests, ...spells] }, commanders: { alice: [name] } }), 'main1');
    const commander = g.zones.command.find((id) => g.objects[id]!.card === name)!;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: commander, autoTap: true }));
    expect(g.objects[commander]!.zone).toBe('battlefield');
    return [g, commander];
  };
  const YES = 'Put it into the command zone instead';

  it('its owner is asked before it moves; put into the command zone, it was never in the hand', () => {
    let [g, captain] = game();
    g = passRound(cast(g, 'alice', 'Unsummon', captain));
    const p = order(g);
    expect(p.player).toBe('alice');
    expect(p.text).toBe("Captain would be put into its owner's hand. Put it into the command zone instead?");
    expect(p.options).toEqual([YES, "Let it go to its owner's hand"]);
    expect(zoneOf(g, captain)).toBe('battlefield');

    const yes = actWithEvents(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: YES } });
    expect(zoneOf(yes.state, captain)).toBe('command');
    expect(yes.state.pending).toBeNull();
    expect(yes.events.filter((e) => e.type === 'moved' && e.object === captain).map((e) => (e as { to: ZoneName }).to)).toEqual(['command']);

    const no = answer(g, 'Let it go');
    expect(zoneOf(no, captain)).toBe('hand');
    // It isn't asked about again where it is.
    expect(no.pending).toBeNull();
  });

  it('to the library the same — and drawn from there, once more', () => {
    let [g, captain] = game();
    g = passRound(cast(g, 'alice', 'Tuck', captain));
    expect(order(g).text).toBe("Captain would be put into its owner's library. Put it into the command zone instead?");
    expect(zoneOf(answer(g, YES), captain)).toBe('command');

    [g, captain] = game();
    g = answer(passRound(cast(g, 'alice', 'Lapse', captain)), 'Let it go');
    expect(g.zones.library.alice![0]).toBe(captain);
    g = passRound(cast(g, 'alice', 'Insight'));
    expect(order(g).text).toBe("Captain would be put into its owner's hand. Put it into the command zone instead?");
    expect(zoneOf(answer(g, YES), captain)).toBe('command');
    expect(zoneOf(answer(g, 'Let it go'), captain)).toBe('hand');
  });

  it("CR 903.9b: its owner decides, whoever controls it", () => {
    let [g, captain] = game();
    g.objects[captain]!.controller = 'bob';
    g = passRound(cast(g, 'alice', 'Unsummon', captain));
    expect(order(g).player).toBe('alice');
    expect(zoneOf(answer(g, YES), captain)).toBe('command');
  });

  it('CR 903.9a: into a graveyard it goes first, and may go on from there — a state-based action, asked after', () => {
    let [g, captain] = game();
    g = passRound(cast(g, 'alice', 'Doom', captain));
    expect(g.pending).toMatchObject({ kind: 'commander_zone', player: 'alice', object: captain, zone: 'graveyard' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'commander_zone', move: true } });
    expect(zoneOf(g, captain)).toBe('command');
  });

  it("CR 616.1f: what another effect makes of the move is looked at afresh — \"shuffle it into its owner's library instead\", then this", () => {
    let [g, hydra] = game('Hydra');
    g = passRound(cast(g, 'alice', 'Doom', hydra));
    expect(order(g).text).toBe("Hydra would be put into its owner's library. Put it into the command zone instead?");
    expect(zoneOf(answer(g, YES), hydra)).toBe('command');
    const no = answer(g, 'Let it go');
    expect(zoneOf(no, hydra)).toBe('library');
    expect(no.pending).toBeNull();
  });

  it('while the engine only looks ahead nobody is asked: it goes to the command zone', () => {
    let [g, captain] = game();
    g = act(cast(g, 'alice', 'Unsummon', captain), { type: 'pass', player: 'alice' });
    const seen = foresee(g, { type: 'pass', player: 'bob' });
    if (!seen.ok) throw new Error(seen.error);
    expect(seen.state.pending).toBeNull();
    expect(seen.state.objects[captain]!.zone).toBe('command');
  });

  it("a card that isn't a commander, and a commander's token copy, are put where they are put", () => {
    let [g] = game();
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Unsummon', bear));
    expect(g.pending).toBeNull();
    expect(zoneOf(g, bear)).toBe('hand');
  });
});

// ---------------------------------------------------------------------------
// Several at once (CR 101.4, 608.2c, 614.12): settled as the game stands before any of them moves
// ---------------------------------------------------------------------------

describe('several permanents moved at once', () => {
  const MANY = [
    ...EXTRA,
    card('Edict', 'Sorcery', 'Each player sacrifices a creature.'),
    card('Barter', 'Sorcery', 'Each player sacrifices all permanents they control.'),
    card('Living Death', 'Sorcery', 'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.'),
    card('Rally', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield.'),
    card('Show and Tell', 'Sorcery', 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.'),
    card('Sovereign', 'Creature — Human', 'Creatures your opponents control enter tapped.', { power: '2', toughness: '1' }),
  ];
  const board = () => toStep(start({ extra: MANY }), 'main1');

  it('the cards these tests go by are read in full', () => {
    for (const c of MANY) expect(c.automation, c.name).toBe('full');
  });

  it('CR 101.4: "each player sacrifices a creature" — at once: Kalitas, sacrificed with it, still exiles the other', () => {
    let g = board();
    const kalitas = give(g, 'alice', 'Kalitas', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Edict'));
    expect(g.pending).toBeNull();
    expect(zoneOf(g, kalitas)).toBe('graveyard');
    expect(zoneOf(g, bear)).toBe('exile');
    expect(tokens(g, 'alice')).toBe(1);
  });

  it('each chooses in turn, and nothing is sacrificed until all have', () => {
    let g = board();
    const mine = [give(g, 'alice', 'Grizzly Bears', 'battlefield'), give(g, 'alice', 'Kalitas', 'battlefield')];
    const theirs = [give(g, 'bob', 'Grizzly Bears', 'battlefield'), give(g, 'bob', 'Grizzly Bears', 'battlefield')];
    g = passRound(cast(g, 'alice', 'Edict'));
    expect(g.pending).toMatchObject({ kind: 'sacrifice', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'sacrifice', objects: [mine[1]!] } });
    expect(g.pending).toMatchObject({ kind: 'sacrifice', player: 'bob' });
    expect(zoneOf(g, mine[1]!)).toBe('battlefield');
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [theirs[0]!] } });
    expect(g.pending).toBeNull();
    expect([zoneOf(g, mine[0]!), zoneOf(g, mine[1]!), zoneOf(g, theirs[0]!), zoneOf(g, theirs[1]!)]).toEqual(['battlefield', 'graveyard', 'exile', 'battlefield']);
    expect(tokens(g, 'alice')).toBe(1);
  });

  it('"sacrifices all permanents": Rest in Peace, sacrificed with the rest, exiles them all — and itself', () => {
    let g = board();
    const rip = give(g, 'alice', 'Rest in Peace', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g = passRound(cast(g, 'alice', 'Barter'));
    expect([zoneOf(g, rip), zoneOf(g, bear), zoneOf(g, forest)]).toEqual(['exile', 'exile', 'exile']);
  });

  it('CR 614.12: creatures returned together — Containment Priest is not there yet for the others to enter under', () => {
    let g = board();
    const priest = give(g, 'alice', 'Containment Priest', 'graveyard');
    const bear = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    g = passRound(cast(g, 'alice', 'Rally'));
    expect([zoneOf(g, priest), zoneOf(g, bear)]).toEqual(['battlefield', 'battlefield']);
    // One returned later finds the Priest there.
    const late = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    g = passRound(cast(g, 'alice', 'Rally'));
    expect(zoneOf(g, late)).toBe('exile');
  });

  it('Living Death: sacrificed at once, returned at once — nothing enters tapped for a creature that enters with it', () => {
    let g = board();
    const sovereign = give(g, 'alice', 'Sovereign', 'graveyard');
    const returned = give(g, 'bob', 'Grizzly Bears', 'graveyard');
    const kalitas = give(g, 'alice', 'Kalitas', 'battlefield');
    const dying = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'alice', 'Living Death'));
    expect([zoneOf(g, kalitas), zoneOf(g, dying)]).toEqual(['graveyard', 'exile']);
    expect(tokens(g, 'alice')).toBe(1);
    expect([zoneOf(g, sovereign), zoneOf(g, returned)]).toEqual(['battlefield', 'battlefield']);
    expect(g.objects[returned]!.tapped).toBe(false);
  });

  it('Show and Tell: what each player puts onto the battlefield enters with the others', () => {
    let g = board();
    const priest = give(g, 'alice', 'Containment Priest', 'hand');
    const bear = give(g, 'bob', 'Grizzly Bears', 'hand');
    g = passRound(cast(g, 'alice', 'Show and Tell'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [priest] } });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [bear] } });
    expect([zoneOf(g, priest), zoneOf(g, bear)]).toEqual(['battlefield', 'battlefield']);
  });
});

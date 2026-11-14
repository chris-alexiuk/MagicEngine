import { legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { advance, DEFAULT_STOPS, dummiesOf, shouldAutoPass, SOLO_STOPS, step, stopsFor, type Ctx, type Stops } from './session';
import { card, compiled, scene as sceneOf, soloSetup } from './testkit';

// Holding priority (CR 117.3c: a player who casts a spell or activates an ability has priority again afterwards).
// By default the table passes it on for them, so that what they cast resolves; a seat that holds keeps it — to
// respond to its own spell. The line here: Nature's Claim on your own Sol Ring, then An Offer You Can't Refuse on the
// Claim, for two Treasures and a Sol Ring that is still there.
const cards = compiled([
  card("Nature's Claim", 'Instant', '{G}', 'Destroy target artifact or enchantment. Its controller gains 4 life.'),
  card("An Offer You Can't Refuse", 'Instant', '{U}', 'Counter target noncreature spell. Its controller creates two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")'),
]);
const setup = soloSetup(["Nature's Claim", "An Offer You Can't Refuse", 'Sol Ring', 'Grizzly Bears']);
const start = (hand: string[]) => sceneOf(setup, cards, ['Sol Ring', 'Forest', 'Island'], hand);
const ctx = (stops: Stops = SOLO_STOPS, holding: Ctx['holding'] = null): Ctx => ({ stops: { p1: stops, p2: DEFAULT_STOPS }, passUntil: null, dummies: dummiesOf(setup), holding });

const castOn = (g: GameState, spell: string, target: string): Action => {
  const a = legalActions(g, 'p1').find((x) => x.type === 'cast' && x.object === spell) as Extract<Action, { type: 'cast' }>;
  return { ...a, targets: [[{ kind: 'object', object: target }]] };
};
const go = (g: GameState, a: Action, c: Ctx): GameState => {
  const r = step(g, a, c);
  if (!r.ok) throw new Error(r.error);
  return r.applied.state;
};
const names = (g: GameState, ids: readonly string[]) => ids.map((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name);
const mine = (g: GameState) => names(g, g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'p1' && !g.cards[g.objects[id]!.card]!.faces[0]!.types.includes('Land')));
const stack = (g: GameState) => g.stack.map((s) => (s.kind === 'spell' ? names(g, [s.object])[0] : 'ability'));

describe('holding priority', () => {
  it('by default your own spell is passed on, and resolves', () => {
    const s = start(["Nature's Claim", "An Offer You Can't Refuse"]);
    const life = s.g.players.p1!.life;
    const g = go(s.g, castOn(s.g, s.inHand("Nature's Claim"), s.id('Sol Ring')), ctx());
    expect([stack(g), mine(g), g.players.p1!.life - life]).toEqual([[], [], 4]);
  });

  it('a seat that holds priority keeps it with its own spell on the stack — whether or not it could do anything', () => {
    const hold: Stops = { ...SOLO_STOPS, hold: true };
    // Nothing else in hand to respond with: still asked, since it said to hold.
    const s = start(["Nature's Claim"]);
    const g = go(s.g, castOn(s.g, s.inHand("Nature's Claim"), s.id('Sol Ring')), ctx(hold));
    expect([g.priority, stack(g), mine(g)]).toEqual(['p1', ["Nature's Claim"], ['Sol Ring']]);
    expect(shouldAutoPass(g, 'p1', hold, null)).toBe(false);
    expect(shouldAutoPass(g, 'p1', SOLO_STOPS, null)).toBe(true);
    // Passing it then is the player's own doing: the spell resolves.
    const after = go(g, { type: 'pass', player: 'p1' }, ctx(hold));
    expect([stack(after), mine(after)]).toEqual([[], []]);
  });

  it("Nature's Claim on your own Sol Ring, held, then An Offer You Can't Refuse on it: two Treasures, and the Sol Ring stays", () => {
    const s = start(["Nature's Claim", "An Offer You Can't Refuse"]);
    const life = s.g.players.p1!.life;
    const claim = s.inHand("Nature's Claim");
    // Held for this spell only (Shift+click, or the box ticked as its target is chosen).
    let g = go(s.g, castOn(s.g, claim, s.id('Sol Ring')), ctx(SOLO_STOPS, 'p1'));
    expect([g.priority, stack(g)]).toEqual(['p1', ["Nature's Claim"]]);
    // The Offer isn't held: it goes on the stack above the Claim, priority passes, and both are dealt with.
    g = go(g, castOn(g, s.inHand("An Offer You Can't Refuse"), claim), ctx());
    expect(stack(g)).toEqual([]);
    expect(mine(g)).toEqual(['Sol Ring', 'Treasure', 'Treasure']);
    expect(names(g, g.zones.graveyard.p1!).filter((n) => /Claim|Offer/.test(n)).sort()).toEqual(["An Offer You Can't Refuse", "Nature's Claim"]);
    expect(g.players.p1!.life).toBe(life);
  });

  it('holding once is that seat only, and only until it has been asked', () => {
    expect(stopsFor(ctx(SOLO_STOPS, 'p1'), 'p1').hold).toBe(true);
    expect(stopsFor(ctx(SOLO_STOPS, 'p1'), 'p2').hold).toBe(false);
    expect(stopsFor(ctx(), 'p1').hold).toBe(false);
    // Asked with the spell on the stack; passing the game on from there without the hold lets it resolve.
    const s = start(["Nature's Claim"]);
    const held = go(s.g, castOn(s.g, s.inHand("Nature's Claim"), s.id('Sol Ring')), ctx(SOLO_STOPS, 'p1'));
    expect(stack(advance(held, ctx()).state)).toEqual([]);
  });
});

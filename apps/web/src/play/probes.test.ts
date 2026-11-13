import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { apply, legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { clickOutcome } from './click';
import { extraCasts, hasXRange } from './probes';
import { newGame, type GameSetup } from './session';

const fixture = JSON.parse(readFileSync(new URL('../../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8')) as ScryfallCard[];
const card = (name: string, type_line: string, mana_cost: string, cmc: number, oracle_text: string, pt?: [string, string]): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost, cmc, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common', games: ['paper'], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) }) as unknown as ScryfallCard;
const cards: Record<string, CardDef> = Object.fromEntries(
  compileCards([
    ...fixture,
    card('Blaze', 'Sorcery', '{X}{R}', 1, 'Blaze deals X damage to any target.'),
    card('By Force', 'Sorcery', '{X}{R}', 1, 'Destroy X target artifacts.'),
    card('Relic', 'Artifact', '{1}', 1, ''),
    card('Mirror Entity', 'Creature — Shapeshifter', '{2}{W}', 3, 'Changeling\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.', ['1', '1']),
  ]).db.cards.map((c) => [c.name, c]),
);
const deck = (main: string[]) => [...main, ...Array.from({ length: 100 - main.length }, () => 'Forest')];
const setup: GameSetup = {
  seed: 3,
  firstPlayer: 'p1',
  seats: [
    { id: 'p1', name: 'Ann', deckName: 'A', commanders: ['Kinnan, Bonder Prodigy'], cards: deck(['Kinnan, Bonder Prodigy', ...Array(12).fill('Blaze'), ...Array(12).fill('Mirror Entity'), ...Array(12).fill('By Force'), ...Array(12).fill('Relic')]) },
    { id: 'p2', name: 'Ben', deckName: 'B', commanders: ['Thrasios, Triton Hero'], cards: deck(['Thrasios, Triton Hero']) },
  ],
};

/** A game at p1's first main phase, with one of each X card where it can be used and four red mana floating. */
function table(): { g: GameState; blaze: string; entity: string } {
  let g = newGame(setup, cards).state;
  while (g.pending?.kind === 'mulligan') {
    const r = apply(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } });
    if (!r.ok) throw new Error(r.error);
    g = r.state;
  }
  for (let i = 0; i < 20 && !(g.step === 'main1' && g.priority === 'p1'); i++) {
    const r = apply(g, { type: 'pass', player: g.priority! });
    if (!r.ok) throw new Error(r.error);
    g = r.state;
  }
  g = structuredClone(g);
  const find = (name: string) => Object.values(g.objects).find((o) => o.owner === 'p1' && g.cards[o.card]?.name === name)!;
  const move = (id: string, to: 'hand' | 'battlefield') => {
    const o = g.objects[id]!;
    for (const z of [g.zones.library.p1!, g.zones.hand.p1!]) if (z.includes(id)) z.splice(z.indexOf(id), 1);
    (to === 'hand' ? g.zones.hand.p1! : g.zones.battlefield).push(id);
    o.zone = to;
    o.controller = 'p1';
  };
  const blaze = find('Blaze').id;
  const entity = find('Mirror Entity').id;
  move(blaze, 'hand');
  move(entity, 'battlefield');
  g.players.p1!.pool.R = 4;
  return { g, blaze, entity };
}
const xs = (list: Action[]) => list.flatMap((a) => (a.type === 'cast' || a.type === 'activate' ? [a.x] : []));

describe('X spells and abilities in the menu', () => {
  it('offers every X the engine says can be paid for, and asks for the number', () => {
    const { g, blaze } = table();
    const listed = legalActions(g, 'p1').filter((a) => a.type === 'cast' && a.object === blaze);
    expect(listed.filter(hasXRange)).toHaveLength(1);
    const extra = extraCasts(g, 'p1', blaze, listed);
    expect(xs(extra)).toEqual([0, 1, 2, 3]);
    for (const a of extra) expect(apply(g, a).ok).toBe(true);
    // The listed range itself is never a one-click action.
    expect(clickOutcome(listed.filter((a) => !hasXRange(a)), extra)).toEqual({ kind: 'menu' });
  });

  it('"X target artifacts": each X comes with that many targets, up to how many there are', () => {
    const { g } = table();
    const find = (name: string) => Object.values(g.objects).filter((o) => o.owner === 'p1' && o.zone === 'library' && g.cards[o.card]?.name === name);
    const force = find('By Force')[0]!;
    g.zones.library.p1!.splice(g.zones.library.p1!.indexOf(force.id), 1);
    g.zones.hand.p1!.push(force.id);
    force.zone = 'hand';
    for (const relic of find('Relic').slice(0, 2)) {
      g.zones.library.p1!.splice(g.zones.library.p1!.indexOf(relic.id), 1);
      g.zones.battlefield.push(relic.id);
      relic.zone = 'battlefield';
      relic.controller = 'p1';
    }
    const listed = legalActions(g, 'p1').filter((a) => a.type === 'cast' && a.object === force.id);
    const extra = extraCasts(g, 'p1', force.id, listed);
    // Four red mana: X up to 3 could be paid for, but there are only two artifacts to target.
    expect(xs(extra)).toEqual([0, 1, 2]);
    expect(extra.map((a) => (a.type === 'cast' ? (a.targets?.[0]?.length ?? 0) : -1))).toEqual([0, 1, 2]);
    for (const a of extra) expect(apply(g, a).ok).toBe(true);
  });

  it('does the same for an ability with {X} in its cost', () => {
    const { g, entity } = table();
    const listed = legalActions(g, 'p1').filter((a) => a.type === 'activate' && a.object === entity);
    const extra = extraCasts(g, 'p1', entity, listed);
    expect(xs(extra)).toEqual([0, 1, 2, 3, 4]);
    expect(clickOutcome(listed.filter((a) => !hasXRange(a)), extra)).toEqual({ kind: 'menu' });
  });
});

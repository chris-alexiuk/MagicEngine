import { legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { abilityCounts, abilityRows } from './abilities';
import { clickOutcome } from './click';
import { actionLabel, manaPreview } from './labels';
import { asYou, narrate } from './log';
import { spendText } from './mana-text';
import { card, compiled, scene as sceneOf, soloSetup } from './testkit';

// What the table shows for a permanent's abilities and for mana: every ability of a card with several (usable or
// not), what a mana ability really adds, and the mana in the log.
const cards = compiled([
  // (The sample set's Kinnan has an older wording of its first line.)
  card('Kinnan, Bonder Prodigy', 'Legendary Creature — Human Druid', '{G}{U}', 'Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.', ['2', '2']),
  card('Shang-Chi, Master of Kung Fu', 'Legendary Creature — Human Warrior Hero', '{1}{G}', 'You may activate abilities of creatures you control as though those creatures had haste.\n{T}: Add two mana of any one color. Spend this mana only to activate abilities of creature sources.', ['2', '2']),
  card('Devoted Druid', 'Creature — Elf Druid', '{1}{G}', '{T}: Add {G}.\nPut a -1/-1 counter on this creature: Untap this creature.', ['0', '2']),
  card('Basalt Monolith', 'Artifact', '{3}', "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact."),
]);
const setup = soloSetup(['Kinnan, Bonder Prodigy', 'Shang-Chi, Master of Kung Fu', 'Devoted Druid', 'Basalt Monolith', 'Grizzly Bears', 'Llanowar Elves']);
const scene = (battlefield: string[], hand: string[] = [], myTurn = 2) => sceneOf(setup, cards, battlefield, hand, myTurn);
const of = (g: GameState, id: string) => legalActions(g, 'p1').filter((a) => 'object' in a && a.object === id);
const rows = (g: GameState, id: string) => abilityRows(g, 'p1', id, of(g, id)).map((r) => `${r.text} => ${r.actions.length ? `${r.actions.length} way${r.actions.length > 1 ? 's' : ''}` : r.why}`);

describe('a permanent’s menu lists every activated ability it has', () => {
  it('both of Devoted Druid’s abilities, usable or not', () => {
    const s = scene(['Kinnan, Bonder Prodigy', 'Devoted Druid', 'Forest']);
    const druid = s.id('Devoted Druid');
    expect(abilityCounts(s.g, 'p1', druid)).toEqual({ abilities: 2, nonMana: 1 });
    expect(rows(s.g, druid)).toEqual(['{T}: Add {G}. => 1 way', 'Put a -1/-1 counter on this creature: Untap this creature. => 1 way']);
    // Tapped for mana: the mana ability stays in the list, with why it can't be used.
    s.run(of(s.g, druid).find((a) => a.type === 'activate_mana')!);
    expect(rows(s.g, druid)).toEqual(['{T}: Add {G}. => Tapped', 'Put a -1/-1 counter on this creature: Untap this creature. => 1 way']);
    // One usable ability left, and the click still opens the menu rather than untapping the Druid at once.
    expect(clickOutcome(of(s.g, druid), [], abilityCounts(s.g, 'p1', druid))).toEqual({ kind: 'menu' });
  });

  it('says why an ability can’t be used: summoning sick, not enough mana, not your move', () => {
    const sick = scene(['Kinnan, Bonder Prodigy', 'Devoted Druid', 'Forest'], [], 1);
    expect(rows(sick.g, sick.id('Devoted Druid'))[0]).toBe('{T}: Add {G}. => Summoning sick');
    const kinnan = sick.id('Kinnan, Bonder Prodigy');
    expect(rows(sick.g, kinnan)).toEqual([expect.stringMatching(/^\{5\}\{G\}\{U\}: Look at the top five cards.* => Not enough mana$/)]);
    // A single ability that can't be used: the click opens the menu to say so. A land that's tapped stays quiet.
    expect(clickOutcome([], [], abilityCounts(sick.g, 'p1', kinnan))).toEqual({ kind: 'menu' });
    const forest = sick.id('Forest');
    sick.run(of(sick.g, forest)[0]!);
    expect(clickOutcome(of(sick.g, forest), [], abilityCounts(sick.g, 'p1', forest))).toEqual({ kind: 'none' });
    // Somebody else's permanent has no menu of abilities.
    expect(abilityRows(sick.g, 'p2', kinnan, [])).toEqual([]);
    expect(abilityCounts(sick.g, 'p2', kinnan)).toEqual({ abilities: 0, nonMana: 0 });
  });

  it('a permanent with one ability still does it on a click; one with nothing to do does nothing', () => {
    const s = scene(['Llanowar Elves', 'Forest']);
    const elves = s.id('Llanowar Elves');
    const listed = of(s.g, elves);
    expect(clickOutcome(listed, [], abilityCounts(s.g, 'p1', elves))).toEqual({ kind: 'act', action: listed[0] });
    expect(clickOutcome([], [])).toEqual({ kind: 'none' });
  });
});

describe('what a mana ability adds is shown in full', () => {
  it('Shang-Chi with Kinnan: two of the colour, and one more from Kinnan', () => {
    const s = scene(['Kinnan, Bonder Prodigy', 'Shang-Chi, Master of Kung Fu']);
    const shang = s.id('Shang-Chi, Master of Kung Fu');
    const green = of(s.g, shang).find((a) => a.type === 'activate_mana' && a.choice === 'G') as Extract<Action, { type: 'activate_mana' }>;
    expect(actionLabel(s.g, green)).toBe('Add {G}{G}, and {G} from Kinnan');
    expect(manaPreview(s.g, green)).toEqual({ own: ['G', 'G'], spend: { abilities: { types: ['Creature'] } }, extra: [{ from: 'Kinnan', mana: ['G'] }] });
    // The log says both, and what the two can be spent on.
    const before = s.g;
    const r = s.run(green);
    const lines = narrate(before, r.state, r.events, () => 0).map((l) => asYou(l.text));
    expect(lines).toEqual(['You tap Shang-Chi, Master of Kung Fu for {G}{G} (only for creature abilities).', 'Kinnan, Bonder Prodigy adds {G}.']);
  });

  it('without Kinnan it is just the two; a plain land is "Add {G}"', () => {
    const s = scene(['Shang-Chi, Master of Kung Fu', 'Forest']);
    const blue = of(s.g, s.id('Shang-Chi, Master of Kung Fu')).find((a) => a.type === 'activate_mana' && a.choice === 'U')!;
    expect(actionLabel(s.g, blue)).toBe('Add {U}{U}');
    expect(actionLabel(s.g, of(s.g, s.id('Forest'))[0]!)).toBe('Add {G}');
  });

  it('mana tapped for automatically while a spell is cast isn’t narrated, but what Kinnan adds is', () => {
    const s = scene(['Kinnan, Bonder Prodigy', 'Basalt Monolith', 'Forest'], ['Grizzly Bears']);
    const bears = Object.values(s.g.objects).find((o) => o.card === 'Grizzly Bears' && o.zone === 'hand')!.id;
    const cast = legalActions(s.g, 'p1').find((a) => a.type === 'cast' && a.object === bears)!;
    const before = s.g;
    const r = s.run(cast);
    const lines = narrate(before, r.state, r.events, () => 0).map((l) => asYou(l.text));
    expect(lines[0]).toBe('You cast Grizzly Bears.');
    expect(lines).toContain('Kinnan, Bonder Prodigy adds {C}.');
    expect(lines.some((l) => /taps? Basalt Monolith/.test(l))).toBe(false);
  });
});

describe('what restricted mana is for, in a few words', () => {
  it('reads like the card', () => {
    expect(spendText({ abilities: { types: ['Creature'] } })).toBe('creature abilities');
    expect(spendText({ spells: { types: ['Creature'] } })).toBe('creature spells');
    expect(spendText({ spells: { types: ['Creature'] }, abilities: { types: ['Creature'] } })).toBe('creature spells and abilities');
    expect(spendText({ spells: { types: ['Instant', 'Sorcery'] } })).toBe('instant or sorcery spells');
    expect(spendText({ spells: { subtypes: ['Dragon'], types: ['Creature'] } })).toBe('Dragon creature spells');
    expect(spendText({ spells: { supertypes: ['Legendary'] } })).toBe('legendary spells');
    expect(spendText({ abilities: {} })).toBe('abilities');
    // A Powerstone.
    expect(spendText({ spells: { types: ['Artifact'] }, abilities: {}, special: ['unlock', 'face_up'], other: true })).toBe('anything but nonartifact spells');
  });
});

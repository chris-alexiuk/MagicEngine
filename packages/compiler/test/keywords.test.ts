import { describe, expect, it } from 'vitest';
import { CORE_KEYWORDS, KeywordRegistry, LEARNED_KEYWORDS } from '../src/keywords.js';

const reg = new KeywordRegistry();

describe('keyword lines', () => {
  it.each([
    ['Flying', [{ id: 'flying' }]],
    ['Flying, vigilance', [{ id: 'flying' }, { id: 'vigilance' }]],
    ['First strike, protection from black', [{ id: 'first_strike' }, { id: 'protection', text: 'black' }]],
    ['Double strike', [{ id: 'double_strike' }]],
    ['Equip {1}', [{ id: 'equip', cost: '{1}' }]],
    ['Ward {2}', [{ id: 'ward', cost: '{2}' }]],
    ['Ward—Pay 3 life.', [{ id: 'ward', cost: 'Pay 3 life' }]],
    [
      'Escape—{G}{G}{U}{U}, Exile five other cards from your graveyard.',
      [{ id: 'escape', cost: '{G}{G}{U}{U}, Exile five other cards from your graveyard' }],
    ],
    ['Cycling—Pay 2 life.', [{ id: 'cycling', cost: 'Pay 2 life' }]],
    ['Basic landcycling {1}', [{ id: 'typecycling', text: 'basic land', cost: '{1}' }]],
    ['Artifact landcycling {2}', [{ id: 'typecycling', text: 'artifact land', cost: '{2}' }]],
    // Learned from their definitions in the rules (CR 702.195a, 702.131, 702.188a): no list here names them.
    ['Storied', [{ id: 'storied' }]],
    ['Ascend', [{ id: 'ascend' }]],
    ['Web-slinging {2}{W}', [{ id: 'web_slinging', cost: '{2}{W}' }]],
    // A keyword this list names keeps its line from one the rules taught ("Equip planeswalker [cost]", CR 702.6e).
    ['Equip planeswalker {1}', [{ id: 'equip', cost: 'planeswalker {1}' }]],
    ['Swampwalk', [{ id: 'landwalk', text: 'swamp' }]],
    ['Crew 3', [{ id: 'crew', n: 3 }]],
    ['Suspend 4—{1}{U}', [{ id: 'suspend', n: 4, cost: '{1}{U}' }]],
    ['Kicker {1}{U} and/or {2}', [{ id: 'kicker', cost: '{1}{U} and/or {2}' }]],
    ['Partner', [{ id: 'partner' }]],
    ['Partner with Pir, Imaginative Rascal', [{ id: 'partner_with', text: 'Pir, Imaginative Rascal' }]],
    ['Enchant creature', [{ id: 'enchant', text: 'creature' }]],
    ['Cumulative upkeep {1}', [{ id: 'cumulative_upkeep', cost: '{1}' }]],
    ['Station', [{ id: 'station' }]],
    ['Start your engines!', [{ id: 'start_your_engines' }]],
  ])('%s', (line, expected) => {
    expect(reg.parseLine(line)).toEqual(expected);
  });

  it.each([
    'Flash creatures you control have haste.',
    'Flashback {2}{R} costs less', // not a keyword line
    'Cycling abilities you activate cost {1} less to activate.',
    'Equipped creature gets +2/+0.',
    'Enchanted creature gets +1/+1.',
    'Flying creatures you control get +1/+1.',
    'Counter target spell.',
  ])('rejects %s', (line) => {
    expect(reg.parseLine(line)).toBeNull();
  });

  it('distinguishes flash from flashback', () => {
    expect(reg.parseLine('Flashback {2}{R}')).toEqual([{ id: 'flashback', cost: '{2}{R}' }]);
    expect(reg.parseLine('Flash')).toEqual([{ id: 'flash' }]);
  });

  it('learns keywords from the rules: a name alone, with a number or with a cost — and only those', () => {
    const learned = Object.fromEntries(LEARNED_KEYWORDS.map((k) => [k.id, k]));
    expect(learned.storied).toEqual({ id: 'storied', name: 'storied', param: 'none', learned: true });
    expect(learned.ascend).toMatchObject({ param: 'none' });
    expect(learned.web_slinging).toEqual({ id: 'web_slinging', name: 'web-slinging', param: 'cost', learned: true });
    // Never one the list above names; never what the rules define of a trigger's wording or of a phrase.
    expect(LEARNED_KEYWORDS.filter((k) => CORE_KEYWORDS.some((c) => c.id === k.id))).toEqual([]);
    expect(Object.keys(learned).filter((id) => /^when|^it_/.test(id))).toEqual([]);
    expect(reg.isLearned('storied')).toBe(true);
    expect(reg.isLearned('flying')).toBe(false);
  });

  it('accepts new keywords at runtime', () => {
    const custom = new KeywordRegistry();
    expect(custom.parseLine('Glimmerstep 2')).toBeNull();
    custom.add({ id: 'glimmerstep', name: 'glimmerstep', param: 'number' });
    expect(custom.parseLine('Glimmerstep 2')).toEqual([{ id: 'glimmerstep', n: 2 }]);
  });
});

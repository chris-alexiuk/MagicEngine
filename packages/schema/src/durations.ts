/**
 * How long an effect lasts (CR 611.2a–b), said once for every effect that has a duration — whatever the effect is.
 * The grammar reads the words once (compiler grammar/effects.ts `parseLasting`) and the engine ends the effect by them
 * once (engine duration.ts), so a duration a card pairs with an effect for the first time needs nothing new.
 *
 *   'eot'                    until end of turn: the cleanup step (CR 514.2)
 *   'eoc'                    until end of combat (CR 511.3)
 *   'your_next_turn'         until your next turn: it ends as that turn begins
 *   'end_of_your_next_turn'  until the end of your next turn: that turn's cleanup step
 *   'game'                   no duration stated: for as long as what it affects is there
 *   'source_tapped'          for as long as its source remains tapped
 *   'source_controlled'      for as long as you control its source
 *   'source_present'         for as long as its source remains on the battlefield (until it leaves the battlefield)
 *   'source_controlled_tapped'  for as long as you control its source and it remains tapped
 *
 * One more is said with a parameter and not a name: "for as long as it has a [kind] counter on it" is `until: 'game'`
 * with `whileCounter: kind` on the node, for the kinds of effect in COUNTER_LASTING.
 */
export const DURATIONS = ['eot', 'eoc', 'your_next_turn', 'end_of_your_next_turn', 'game', 'source_tapped', 'source_controlled', 'source_present', 'source_controlled_tapped'] as const;
export type Duration = (typeof DURATIONS)[number];

/** Durations counted in turns: all an effect kept by turn number can last (a rule for a player, a ban on casting). */
const BY_TURN: readonly Duration[] = ['eot', 'your_next_turn', 'end_of_your_next_turn', 'game'];

/**
 * The kinds of effect that take a duration, each with the durations it can have. The engine's handler for one of these
 * ends what it makes through duration.ts (a test holds it to that), so the grammar may give any of them to it.
 */
export const LASTING_EFFECTS: Readonly<Record<string, readonly Duration[]>> = {
  modify: DURATIONS,
  gain_control: DURATIONS,
  player_effect: BY_TURN,
  prohibit_casting: BY_TURN,
  // A triggered ability made for a while (CR 603.7): "Until your next turn, whenever a creature attacks you, …".
  turn_trigger: ['eot', 'your_next_turn', 'end_of_your_next_turn'],
};

/** The kinds of effect that can last "for as long as it has a [kind] counter on it" (`whileCounter` on the node). */
export const COUNTER_LASTING: readonly string[] = ['modify', 'gain_control'];

/**
 * The parameters of an effect that may be a counted amount — "X", "the number of creatures you control" — and not only
 * a number: the engine works each of these out as the effect is applied (CR 608.2h). The grammar reads a counted amount
 * once for all of them (compiler effects.ts `parseSomeNumber`); a parameter not listed here is only ever given a number.
 * (Taken from the pool: every one of these carries a counted amount on some card.)
 */
export const COUNTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  add_counters: ['amount'],
  add_mana: ['times'],
  amass: ['amount'],
  bolster: ['amount'],
  choose_from_hand: ['amount'],
  connive: ['amount'],
  copy_spell: ['amount'],
  create_token: ['amount', 'size'],
  deal_damage: ['amount'],
  dig: ['amount', 'take', 'totalMV'],
  discard: ['amount'],
  discover: ['n'],
  draw: ['amount'],
  exile_top: ['amount'],
  extra_turn: ['count'],
  gain_life: ['amount'],
  get_counters: ['amount'],
  incubate: ['amount'],
  lose_life: ['amount'],
  may_pay: ['maxX', 'times', 'xIs'],
  mill: ['amount'],
  modify: ['livePower', 'liveToughness', 'power', 'setPower', 'setToughness', 'toughness'],
  monstrosity: ['amount'],
  move: ['beneath'],
  next_spell: ['reduce'],
  piles: ['amount'],
  prevent: ['amount'],
  remove_counters: ['amount'],
  reorder_top: ['amount'],
  repeat: ['times'],
  sacrifice: ['amount'],
  sacrifice_choice: ['amount'],
  scry: ['amount'],
  search: ['amount'],
  set_life: ['amount'],
  skip_next: ['amount'],
  spell_enter_counters: ['amount'],
  surveil: ['amount'],
  unless_pays: ['costEnergy', 'costX'],
};

/**
 * The kinds of instruction the engine can tell were done: it knows, as the instruction is about to be followed, whether
 * it can be (there is something to sacrifice, the creature is untapped, the card is still where it was). "[Do this]. If
 * you do, [that]." is read once for all of them (compiler effects.ts, the sentence loop): that happens only if this
 * could be done (CR 608.2c). The engine's `feasible` judges each kind here (a test holds it to that); an instruction of
 * any other kind is never followed by "if you do".
 */
export const DOABLE: readonly string[] = ['discard', 'exchange_control', 'mill', 'move', 'remove_counters', 'return_chosen', 'sacrifice', 'sacrifice_choice', 'tap'];

/**
 * The kinds of static ability that can hold only while a condition does ("As long as …", "… if …", "… unless …",
 * CR 611.3a): the engine checks `effect.condition` wherever it reads one of these. The grammar reads the condition's
 * wording once for all of them (compiler lines.ts `conditionalStaticRule`); a kind not listed here is never given one.
 */
export const CONDITIONAL_STATICS: readonly string[] = [
  'continuous', 'enters_with_counters', 'cast_option', 'cost_modifier', 'cast_restriction', 'prevent_damage', 'player_rule', 'top_permission', 'attack_tax',
  'cast_prohibition', 'exile_play', 'replace_quantity', 'redirect_damage', 'draw_replacement', 'grant_retrace',
];

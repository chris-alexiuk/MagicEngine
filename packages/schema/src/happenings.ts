/**
 * What a card can ask of the turn's history (the engine's history.ts): "if a creature died this turn", "for each
 * permanent you sacrificed this turn", "if a card left your graveyard this turn". The engine keeps every move, token
 * and sacrifice of the turn with what it was about as it then was; each kind here is a reading of those, so a new
 * question is a kind and a filter — nothing new for the engine to keep.
 *
 *   died               a permanent put into a graveyard from the battlefield (CR 700.4)
 *   left               a permanent that left the battlefield
 *   returned_to_hand   a permanent put into a hand from the battlefield
 *   put_into_graveyard a card or token put into a graveyard from anywhere
 *   exiled             a card or token put into exile from anywhere
 *   left_graveyard     a card that left a graveyard
 *   sacrificed         a permanent sacrificed
 *   created            a token created
 */
export const HAPPENINGS = ['died', 'left', 'returned_to_hand', 'put_into_graveyard', 'exiled', 'left_graveyard', 'sacrificed', 'created'] as const;
export type HappeningKind = (typeof HAPPENINGS)[number];

/**
 * The parts of an object filter such a question can use — what the thing was, and whose: its types as it last existed
 * on the battlefield (as its card is printed, for a question about cards), `controller` who controlled it (who
 * sacrificed or created it), `owner` whose graveyard or hand it went to. The grammar reads no question whose filter
 * asks for more, and the engine answers none.
 */
export const HAPPENED_FILTER: readonly string[] = ['types', 'notTypes', 'subtypes', 'notSubtypes', 'supertypes', 'token', 'controller', 'owner'];

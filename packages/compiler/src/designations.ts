import { KEYWORD_DEFINITIONS } from './keyword-definitions.js';

/**
 * Designations a player has that are only markers (CR 702.131c the city's blessing, 702.195b an enduring story): the
 * ones a keyword's definition gives — "…, you get the city's blessing for the rest of the game." They are named here as
 * the rules say them, article and all ("the city's blessing", "an enduring story"), so a set that brings a new one needs
 * only its rule.
 */
const GIVES = /\byou (?:get|have) ((?:the|an?) [a-z][a-z' -]*?) for the rest of the game\b/;

export const DESIGNATIONS: string[] = [
  ...new Set(
    Object.values(KEYWORD_DEFINITIONS)
      .flatMap((d) => [...d.meaning, ...(d.spell?.meaning ?? [])])
      .map((sentence) => GIVES.exec(sentence)?.[1])
      .filter((name): name is string => Boolean(name)),
  ),
];

const NAMES = DESIGNATIONS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

/** "you have the city's blessing", "you don't have an enduring story". */
export const HAS_DESIGNATION = new RegExp(`^you (don't have|have) (${NAMES})$`);
/** "you get the city's blessing for the rest of the game", "you have an enduring story for the rest of the game". */
export const GETS_DESIGNATION = new RegExp(`^you (?:get|have) (${NAMES}) for the rest of the game$`, 'i');
/** "Any time [condition] and you don't have [it], you get [it] for the rest of the game." */
export const DESIGNATION_RULE = new RegExp(`^Any time (.+?) and you don't have (${NAMES}), you (?:get|have) \\2 for the rest of the game\\.$`);

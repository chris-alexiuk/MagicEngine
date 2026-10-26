# Architecture

## Decisions

- **Browser client, authoritative server.** The server holds the full game state; each client gets a redacted view, so hidden information stays hidden. Humans only for now (no AI opponents).
- **Commander is the primary format.** 2-player games are the simpler case.
- **Cards are data.** Scryfall bulk data is compiled at build time into a compact DB plus an ability AST. No LLM in the pipeline.
- **Every card is playable on day one.** Lines the compiler can't turn into AST are resolved by players by hand ("manual"); the engine still handles casting, zones and the stack.
- **License: undecided.** Using Forge's GPL-3.0 card scripts would boost coverage but make the project GPL. Decide during milestone 3, now that the coverage report shows what our own grammar reaches.

## Card pipeline

```
Scryfall Oracle Cards JSON (~150 MB)
  → compiler: structure (types, costs, faces, legality)
              keyword lines      → KeywordRegistry
              templated lines    → grammar rules → AST
              everything else    → unparsed (manual in play)
  → cards.json.gz (a few MB) + cards.meta.json + coverage report
```

- Each oracle line is checked in order: reminder text stripped → keyword line? → grammar rules → unparsed. A modal header ("Choose one —") and its bullets are one block.
- Self-references ("Kinnan", "this creature") are normalised to `~` before matching, covering old and new templating.
- The grammar is compositional (`packages/compiler/src/grammar/`): a line is a trigger, cost or static subject plus effect text; effect text is sentences, clauses joined by "and" / ", then", and a subject plus a verb. Noun phrases ("up to two target nonblack creatures an opponent controls") become a target spec or a filter; pronouns ("it", "its controller", "that player") resolve to what they refer to. Subtype names come from CR 205.3 (`pnpm rules:subtypes`).
- All or nothing: a line compiles completely or not at all, so a compiled card never does half of what it says.
- **Keywords come from the Comprehensive Rules.** Most keyword abilities are defined in CR 702 as a sentence ("Prowess" means "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn."). `pnpm rules:keywords` extracts those definitions, and the compiler parses them with the same grammar as card text, attaching the result to the keyword. A keyword starts working as soon as the grammar can read its definition. Keywords with no such definition (flying, trample, flashback, kicker…) are applied natively; the rest are recorded but graded manual (`keywordSupported` in the schema).
- The coverage report groups unparsed lines into templates ranked by frequency. `pnpm cards:reparse` re-runs the grammar over a built DB in seconds to measure a change.

## Extensibility

AST nodes use open string tags (`kind`, `type`). The compiler resolves keywords and grammar rules through registries; the engine resolves effects, trigger conditions, enters-the-battlefield replacements and static tags through registries keyed by the same tags (`installPlugin`). A new mechanic is a plugin: keyword spec and/or grammar rules on the compiler side, handlers on the engine side. Nothing in the core switches on card names.

The contract between the two sides is `CORE_NODES` in `packages/schema`: the tags the engine core handles. Tests on both sides check it, and the data workflow checks every compiled card against it.

## Storage in the browser

- **Card DB:** stored in Cache Storage keyed by its sha256. A reload fetches only the small meta file; a new DB downloads only when the hash changes.
- **Images:** never bulk-downloaded. Loaded on demand from Scryfall's CDN (`small` for the grid on 1× screens, `normal` otherwise). A service worker caches them under a byte budget (default 250 MB, user-adjustable), evicting least recently viewed first. Pinned images (cards in saved decks) are never evicted.
- **Fallback:** if an image is slow or blocked, a text proxy of the card shows instead.
- **Scryfall image rules:** never cover, crop or distort the artist/copyright line.

## Engine

- Pure, deterministic TypeScript (seeded RNG, no DOM). Runs in a Web Worker and in Node.
- `createGame()` sets up; `apply(state, action) → { state, events }` is the only way state changes. An illegal action returns an error and leaves the state untouched (CR 733.1).
- When a player must decide, `state.pending` says who and what. UI and remote players answer the same way.
- `viewFor(state, player)` is what the server sends each client: hidden zones become counts.
- Anything the engine can't run goes through manual resolution: the spell or ability waits on the stack while its controller makes logged manual moves, then confirms.
- **Targets** are chosen when a spell is cast or an ability activated (in the action), or when a trigger goes on the stack (a prompt). They're rechecked on resolution; with all of them illegal the spell doesn't resolve (CR 608.2b). Hexproof, shroud and protection are enforced.
- **Resolution** runs the effects in order and can stop for a choice (scry, discard, "you may", "unless … pays", search); the answer resumes it. Effects reach their subjects through references, with last-known information for objects that moved.
- **Triggers** are detected from events in batches, look back in time for leaves-the-battlefield abilities (CR 603.10a), and go on the stack in APNAP order before anyone gets priority.
- **Characteristics** go through the layer system: printed values, then continuous effects from static abilities (not locked in) and resolved spells (locked in), in layer and timestamp order. Layers 2 (control), 6, 7a (characteristic-defining P/T, which works in every zone), 7b and 7c are implemented so far; the rest arrive with the effects that need them. Lookups that don't change the state (a legal-actions listing) share one cache of effects, conditions and counts.
- **Counted amounts** ("for each creature you control", "equal to its power", "where X is your devotion to black") compile to expressions the engine counts: once as a one-shot effect resolves (CR 608.2h), continuously for static abilities. Objects that left the battlefield are counted as they last existed there.
- **Conditional statics** ("As long as …", "During your turn, …") are checked every time characteristics are computed (CR 611.3a). A condition that itself looks at characteristics can't see its own ability while it's being checked, which stops loops; results are memoised for the duration of one outermost lookup.
- **"As ~ enters" choices** (shocklands, reveal lands, "choose a color/creature type", CR 614.12) are recorded as the permanent enters and asked for before anyone gets priority or triggers go on the stack. No player can act in between, so it's the same as choosing as it enters. The answer is remembered on the permanent ("of the chosen type", "one mana of the chosen color").
- **Rules for players** ("no maximum hand size", "an additional land", "skip your draw step", "look at the top card of your library") are static abilities read where the rule applies (`player-rules.ts`).
- `scripts/fuzz.ts` plays random games with random decks from the full card pool and checks every action and the state's invariants.
- Every implemented rule is cited as `CR x.y` in code and tests; [docs/rules/TRACE.md](rules/TRACE.md) shows coverage by section. See [docs/rules/README.md](rules/README.md).

## Milestones

1. ✅ Card pipeline, image cache, card browser
2. Engine core, 2-player same-screen
   - ✅ Setup and London mulligan, turn structure, priority, stack, land plays, mana abilities, casting and resolution, state-based actions, cleanup, manual resolution, player views
   - ✅ Combat: attackers (incl. multiple opponents and planeswalkers), blockers with evasion and protection, first/double strike, trample, deathtouch, lifelink, infect, wither, toxic; commanders in the command zone with tax, and commander damage
   - Same-screen table UI
3. Effects system and parser v1
   - ✅ Compositional grammar: spells, triggered, activated and static abilities, modal spells, tokens, costs (mana, tap, sacrifice, life, loyalty)
   - ✅ Targets and resolution: target rules, fizzling, hexproof/shroud/protection, counterspells, choices during resolution, library search, "unless … pays"
   - ✅ Triggered abilities: enters, dies, leaves, attacks, blocks, combat damage, steps, casting, life gain, drawing
   - ✅ Continuous effects: anthems and lords, granted keywords and restrictions, until-end-of-turn effects; Auras and Equipment
   - ✅ Keywords compiled from their CR 702 definitions (prowess, cycling, typecycling, equip, ward, exalted, battle cry, bushido, flanking, afterlife, annihilator, persist, undying…), plus flashback, kicker and changeling natively
   - ✅ Sacrifice choices (edicts, costs, additional costs), discard costs, conditions ("if"), intervening "if" (CR 603.4), "you may … If you do", delayed triggers (CR 603.7), control changes (layer 2), "exile it instead" replacements, prevention shields
   - ✅ Conditional statics ("as long as", "during your turn"), player rules (hand size, extra lands, skip draw, top of library), lands that check or ask as they enter (checklands, fastlands, shocklands, reveal lands, "choose a color"), abilities that work from the graveyard (CR 113.6m), exile until ~ leaves (CR 610.3), adapt, explore, the monarch (CR 725), blocking restrictions and requirements (CR 509.1b–c)
   - ✅ Counted amounts and characteristic-defining P/T, cost increases and reductions (CR 601.2f), modal spells with modes the compiler can't read (those modes resolve by hand), energy (CR 107.14), player hexproof/shroud and "can't gain life", linked "the exiled card" abilities (CR 607.2a)
   - ✅ Sagas (CR 714), impulse draw (play from exile until a duration ends), damage and life-loss triggers with "that much" (CR 603.10), proliferate, connive, amass, "doesn't untap during its next untap step", "return it transformed" (CR 712.14a) and finding objects an effect moved (CR 400.7j)
   - Next: the remaining layers (type, color, text), copy effects, alternative costs, replacement effects for life gain/tokens/counters, blockers that block several creatures, levelers and Classes, "from the top of your library"
4. 4-player Commander and online play via the server
5. Deck editor: search, Moxfield/Archidekt import/export, legality, color identity, Game Changers
6. Coverage grind guided by the report

# Architecture

## Decisions

- **Browser client, authoritative server.** The server holds the full game state; each client gets a redacted view, so hidden information stays hidden. Humans only for now (no AI opponents).
- **Commander is the primary format.** 2-player games are the simpler case.
- **Cards are data.** Scryfall bulk data is compiled at build time into a compact DB plus an ability AST. No LLM in the pipeline.
- **Every card is playable on day one.** Lines the compiler can't turn into AST are resolved by players by hand ("manual"); the engine still handles casting, zones and the stack.
- **License: undecided.** Using Forge's GPL-3.0 card scripts would boost coverage but make the project GPL. Decide at milestone 3, once the coverage report shows what Forge would add.

## Card pipeline

```
Scryfall Oracle Cards JSON (~150 MB)
  → compiler: structure (types, costs, faces, legality)
              keyword lines      → KeywordRegistry
              templated lines    → grammar rules → AST
              everything else    → unparsed (manual in play)
  → cards.json.gz (a few MB) + cards.meta.json + coverage report
```

- Each oracle line is checked in order: reminder text stripped → keyword line? → grammar rules → unparsed.
- Self-references ("Kinnan", "this creature") are normalised to `~` before matching, covering old and new templating.
- The coverage report groups unparsed lines into templates ranked by frequency. Each row is a grammar rule waiting to be written.

## Extensibility

AST nodes use open string tags (`kind`, `type`). The compiler resolves keywords and grammar rules through registries; the engine will resolve effects, triggers and keywords through registries keyed by the same tags. A new mechanic is a plugin: keyword spec and/or grammar rules on the compiler side, handlers on the engine side. Nothing in the core switches on card names.

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
- Every implemented rule is cited as `CR x.y` in code and tests; [docs/rules/TRACE.md](rules/TRACE.md) shows coverage by section. See [docs/rules/README.md](rules/README.md).

## Milestones

1. ✅ Card pipeline, image cache, card browser
2. Engine core, 2-player same-screen
   - ✅ Setup and London mulligan, turn structure, priority, stack, land plays, mana abilities, casting and resolution, state-based actions, cleanup, manual resolution, player views
   - ✅ Combat: attackers (incl. multiple opponents and planeswalkers), blockers with evasion and protection, first/double strike, trample, deathtouch, lifelink, infect, wither, toxic; commanders in the command zone with tax, and commander damage
   - Same-screen table UI
3. Effects system: triggers, statics and layers, replacement effects; parser v1
4. 4-player Commander and online play via the server
5. Deck editor: search, Moxfield/Archidekt import/export, legality, color identity, Game Changers
6. Coverage grind guided by the report

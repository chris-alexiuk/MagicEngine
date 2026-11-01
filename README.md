# MagicEngine

A browser-based Magic: The Gathering rules engine for 2–4 player games, Commander first. Cards are compiled from Scryfall data without hand-scripting; anything the engine can't run yet is still playable by resolving it manually.

Status: milestone 3 of 6 in progress. The engine runs turns, priority, the stack, mana, casting, combat and state-based actions, plus compiled card abilities: targeted spells, triggered and activated abilities, static effects through the layer system, Auras and Equipment. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the [rules trace](docs/rules/TRACE.md).

## Quick start

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm cards:fixture   # ~30-card sample DB, works offline
# or
pnpm cards:build     # downloads Scryfall's Oracle Cards file (~150 MB) and compiles every card
pnpm dev             # http://localhost:5173
```

`pnpm cards:build` also writes `apps/web/public/coverage.md`: which cards the engine fully understands, and the most common rules-text templates it doesn't yet.

## Try it

```sh
git clone https://github.com/chris-alexiuk/magicengine.git
cd magicengine
pnpm install
pnpm cards:build     # downloads Scryfall's Oracle Cards file and compiles the full card DB (a few minutes)
pnpm dev             # then open http://localhost:5173
```

- **Cards**: search every card and see which rules lines the engine runs and which you resolve by hand.
- **Decks**: build a Commander deck (search with type, colour, mana value and engine-coverage filters; add cards; choose a commander or a partner/Background pair), or **Import** a list pasted from Moxfield, Archidekt, MTGO, Arena or plain text. Unmatched lines are listed, never dropped. The deck shows as columns of overlapping cards by type (or a list), with its commander, mana curve, coloured mana symbols, count, colour-identity and singleton problems, and how many cards are automatic, partial or manual. Moxfield/Archidekt links are tried straight from the browser, which those sites usually block; the dialog then says how to copy the list as text. **Export** gives the list back as text. **Playtest** starts a solo game with the deck.
- **Play**, in three ways: a **solo playtest** against a practice dummy that never acts (with undo), **open hands** (you play every seat, every hand face up), or **pass the device** (2–4 players, each sees only their own hand). Only actions the engine lists as legal are lit: click a card with one thing to do and it's done (a land is played, a spell is cast with mana tapped for you); with several, a small menu opens at the card; drag a card from your hand to play it; right-click for every option and a large view. Targets, attackers (or **Attack with all**; click a player's life total to choose who) and blockers (a creature, then the attacker) are chosen on the table, with arrows. Priority passes for you except at your main phases, combat, and anything you could answer; **Stops** changes that. Keys: Space or Enter for the main button, F2 pass, F6 pass to end of turn, Z undo, Esc cancel. Cards the engine can't run pause on the stack so you can resolve them by hand. The game is saved in the browser and can be resumed.

Card images come from Scryfall's CDN on demand and are cached by a service worker (images of cards in saved decks are pinned); without them (offline, or on a page that blocks the image CDN) every card is drawn as a proxy: its frame colour, name, mana cost and type, the rules text where there's room, and a compact face on the battlefield. Mana symbols are drawn with the [Mana font](https://mana.andrewgioia.com) (SIL OFL 1.1), bundled with the app. `pnpm cards:fixture` builds a 30-card sample DB offline, too small for a Commander deck.

## Layout

| Path | What it is |
|---|---|
| `packages/schema` | Compiled card format and ability AST, shared by everything |
| `packages/compiler` | Scryfall JSON → compiled card DB + coverage report |
| `packages/rules` | Comprehensive Rules parser and the rule-citation trace |
| `packages/engine` | Rules engine |
| `apps/web` | Browser client: card browser, deck builder, same-screen game table |
| `apps/server` | Authoritative game server (milestone 4) |

## Scripts

`pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm rules:trace` (regenerates the rules trace) · `pnpm rules:check` · `pnpm rules:subtypes` / `pnpm rules:keywords` (regenerate the subtype lists and keyword definitions the compiler reads from the Comprehensive Rules) · `pnpm cards:reparse` (re-runs the grammar over the built card DB and checks the compiler/engine contract) · `pnpm fuzz` (random games with the built card DB)

The **Reference data** workflow refreshes the Comprehensive Rules and rebuilds the full card DB weekly, on demand, and whenever the parsers change. The card DB and coverage report land on the `reports` branch.

## Data

Card data and images come from [Scryfall](https://scryfall.com/docs/api). This is unofficial fan content permitted under the Wizards of the Coast Fan Content Policy; it is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

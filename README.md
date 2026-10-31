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
- **Decks**: build a Commander deck (search, add, choose a commander or a partner/Background pair), or **Import** a list pasted from Moxfield, Archidekt, MTGO, Arena or plain text. Unmatched lines are listed, never dropped. The deck shows its count, color-identity and singleton problems, and how many cards are automatic, partial or manual. Moxfield/Archidekt links are tried straight from the browser, which those sites usually block; the dialog then says how to copy the list as text. **Export** gives the list back as text.
- **Play**: pick a saved deck for each of 2–4 players and start a same-screen Commander game. Before each decision the table asks you to pass the device, so each player sees only their own hand. Only actions the engine lists as legal are offered: click a highlighted card to see what you can do with it; targets, attackers and blockers are chosen by clicking the highlighted candidates. Mana is tapped automatically (or tap lands yourself first). Cards the engine can't run pause on the stack so you can resolve them by hand. “Stops” sets where each player wants to be asked; everywhere else priority passes for them. The game is saved in the browser and can be resumed.

Card images come from Scryfall's CDN on demand and are cached by a service worker (images of cards in saved decks are pinned); without a connection a text version of each card shows instead. `pnpm cards:fixture` builds a 30-card sample DB offline, too small for a Commander deck.

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
